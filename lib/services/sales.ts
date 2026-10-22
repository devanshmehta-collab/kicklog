import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { DB } from "../db";
import {
  customers,
  inventoryLots,
  inventoryMovements,
  lotOwnershipAllocations,
  lotProfitAllocations,
  productVariants,
  products,
  refunds,
  saleExpenses,
  saleItems,
  sales,
} from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { NO_COSTS, allocateProportionally, computeRefund, computeSale, splitProfit, type SaleCosts } from "../profit";
import { audit } from "./audit";
import { isUniqueViolation, lockLotsFifo } from "./inventory";

export interface SaleLineInput {
  variantId: string;
  /** Pin a specific acquisition lot; omit for FIFO. */
  lotId?: string;
  quantity: number;
  unitPricePaise: number;
}

export interface CustomerRef {
  id?: string;
  name?: string;
  phone?: string | null;
  instagram?: string | null;
  city?: string | null;
  type?: "D2C" | "B2B";
}

export interface SaleInput {
  idempotencyKey: string;
  lines: SaleLineInput[];
  customer?: CustomerRef | null;
  channel?: string;
  saleDate?: Date;
  costs?: Partial<SaleCosts>;
  expenses?: { label: string; amountPaise: number }[];
  notes?: string | null;
  source?: "manual" | "ai" | "sourcing";
  aiRequestId?: string | null;
  reviewId?: string | null;
  createdBy?: string | null;
}

export interface SaleResult {
  duplicate: boolean;
  saleId: string;
  profitPaise: number;
  netProceedsPaise: number;
  cogsPaise: number;
}

async function resolveCustomer(tx: DB, ref?: CustomerRef | null): Promise<string | null> {
  if (!ref) return null;
  if (ref.id) {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, ref.id));
    if (!c) throw notFound("Customer not found");
    return c.id;
  }
  if (!ref.name?.trim()) return null;
  if (ref.phone) {
    const [c] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.phone, ref.phone));
    if (c) return c.id;
  } else {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(sql`lower(${customers.name}) = ${ref.name.trim().toLowerCase()}`);
    if (c) return c.id;
  }
  const [created] = await tx
    .insert(customers)
    .values({ name: ref.name.trim(), phone: ref.phone ?? null, instagram: ref.instagram ?? null, city: ref.city ?? null, type: ref.type ?? "D2C" })
    .returning({ id: customers.id });
  return created.id;
}

async function findSaleByKey(db: DB, key: string): Promise<SaleResult | null> {
  const [s] = await db.select().from(sales).where(eq(sales.idempotencyKey, key));
  return s ? { duplicate: true, saleId: s.id, profitPaise: s.profitPaise, netProceedsPaise: s.netProceedsPaise, cogsPaise: s.cogsPaise } : null;
}

/**
 * The one and only way a sale is created (manual form, AI Quick Log and review confirmation all call this).
 * Validates stock, locks lots, decrements FIFO, records movement, computes profit and partner allocations —
 * all in one transaction.
 */
export async function recordSale(db: DB, input: SaleInput): Promise<SaleResult> {
  if (!input.lines.length) throw badRequest("A sale needs at least one item");
  for (const l of input.lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw badRequest("Quantity must be a positive whole number");
    if (!Number.isInteger(l.unitPricePaise) || l.unitPricePaise < 0) throw badRequest("Sale price must be a non-negative amount");
  }
  const prior = await findSaleByKey(db, input.idempotencyKey);
  if (prior) return prior;

  const extra = (input.expenses ?? []).reduce((a, e) => a + e.amountPaise, 0);
  const costs: SaleCosts = {
    ...NO_COSTS,
    ...input.costs,
    otherExpensesPaise: (input.costs?.otherExpensesPaise ?? 0) + extra,
  };

  try {
    return await db.transaction(async (tx) => {
      // 1. allocate stock (FIFO across lots) with row locks
      interface Alloc {
        lotId: string;
        variantId: string;
        quantity: number;
        unitPricePaise: number;
        unitCostPaise: number;
      }
      const allocs: Alloc[] = [];
      const lotLeft = new Map<string, number>();
      for (const line of input.lines) {
        const lots = await lockLotsFifo(tx, line.variantId, line.lotId);
        let need = line.quantity;
        for (const lot of lots) {
          const avail = lotLeft.get(lot.id) ?? lot.quantityRemaining;
          if (avail <= 0) continue;
          const take = Math.min(avail, need);
          lotLeft.set(lot.id, avail - take);
          allocs.push({ lotId: lot.id, variantId: line.variantId, quantity: take, unitPricePaise: line.unitPricePaise, unitCostPaise: lot.unitCostPaise });
          need -= take;
          if (need === 0) break;
        }
        if (need > 0) throw conflict("Not enough stock available for this sale", { variantId: line.variantId, short: need });
      }

      // 2. deterministic financials
      const totals = computeSale(allocs, costs);
      const customerId = await resolveCustomer(tx, input.customer);

      // 3. sale + items
      const [sale] = await tx
        .insert(sales)
        .values({
          customerId,
          channel: input.channel ?? "whatsapp",
          saleDate: input.saleDate ?? new Date(),
          idempotencyKey: input.idempotencyKey,
          discountPaise: costs.discountPaise,
          shippingRevenuePaise: costs.shippingRevenuePaise,
          shippingCostPaise: costs.shippingCostPaise,
          feesPaise: costs.feesPaise,
          otherExpensesPaise: costs.otherExpensesPaise,
          grossRevenuePaise: totals.grossRevenuePaise,
          netProceedsPaise: totals.netProceedsPaise,
          cogsPaise: totals.cogsPaise,
          profitPaise: totals.profitPaise,
          notes: input.notes ?? null,
          source: input.source ?? "manual",
          aiRequestId: input.aiRequestId ?? null,
          reviewId: input.reviewId ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      if (input.expenses?.length) {
        await tx.insert(saleExpenses).values(input.expenses.map((e) => ({ saleId: sale.id, label: e.label, amountPaise: e.amountPaise })));
      }
      const items = await tx
        .insert(saleItems)
        .values(
          allocs.map((a, i) => ({
            saleId: sale.id,
            lotId: a.lotId,
            variantId: a.variantId,
            quantity: a.quantity,
            unitPricePaise: a.unitPricePaise,
            unitCostPaise: a.unitCostPaise,
            discountPaise: totals.lineDiscountsPaise[i],
          })),
        )
        .returning();

      // 4. decrement stock + ledger
      for (const [lotId, left] of lotLeft) {
        await tx.update(inventoryLots).set({ quantityRemaining: left }).where(eq(inventoryLots.id, lotId));
      }
      await tx.insert(inventoryMovements).values(
        items.map((it) => ({
          lotId: it.lotId,
          variantId: it.variantId,
          type: "sale" as const,
          quantity: -it.quantity,
          refType: "sale",
          refId: sale.id,
        })),
      );

      // 5. partner allocation per sale item
      const overhead = costs.shippingRevenuePaise - costs.shippingCostPaise - costs.feesPaise - costs.otherExpensesPaise;
      const grossWeights = items.map((it) => it.quantity * it.unitPricePaise);
      const overheadShare = allocateProportionally(overhead, grossWeights.some((w) => w > 0) ? grossWeights : items.map((i) => i.quantity));
      const lotIds = [...new Set(items.map((i) => i.lotId))];
      const owners = await tx.select().from(lotOwnershipAllocations).where(inArray(lotOwnershipAllocations.lotId, lotIds));
      const allocRows: (typeof lotProfitAllocations.$inferInsert)[] = [];
      items.forEach((it, i) => {
        const itemProfit = grossWeights[i] - it.discountPaise - it.quantity * it.unitCostPaise + overheadShare[i];
        const shares = owners.filter((o) => o.lotId === it.lotId).map((o) => ({ partnerId: o.partnerId, profitShareBps: o.profitShareBps }));
        for (const slice of splitProfit(itemProfit, shares)) {
          allocRows.push({ saleId: sale.id, saleItemId: it.id, lotId: it.lotId, partnerId: slice.partnerId, profitPaise: slice.profitPaise });
        }
      });
      await tx.insert(lotProfitAllocations).values(allocRows);

      await audit(tx, {
        userId: input.createdBy,
        action: "sale.create",
        entity: "sale",
        entityId: sale.id,
        detail: { source: input.source ?? "manual", aiRequestId: input.aiRequestId, reviewId: input.reviewId, profitPaise: totals.profitPaise },
      });
      return { duplicate: false, saleId: sale.id, profitPaise: totals.profitPaise, netProceedsPaise: totals.netProceedsPaise, cogsPaise: totals.cogsPaise };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findSaleByKey(db, input.idempotencyKey);
      if (again) return again;
    }
    throw e;
  }
}

export interface RefundInput {
  saleItemId: string;
  quantity: number;
  restock: boolean;
  /** Defaults to the proportional amount the buyer paid for these units. */
  amountPaise?: number;
  reason?: string | null;
  idempotencyKey: string;
  userId?: string | null;
}

export async function refundSaleItem(db: DB, input: RefundInput) {
  const [prior] = await db.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey));
  if (prior) return { duplicate: true, refundId: prior.id, profitDeltaPaise: prior.profitDeltaPaise };
  try {
    return await db.transaction(async (tx) => {
      const [item] = await tx.select().from(saleItems).where(eq(saleItems.id, input.saleItemId)).for("update");
      if (!item) throw notFound("Sale item not found");
      let calc;
      try {
        calc = computeRefund(item, input.quantity, input.restock, input.amountPaise);
      } catch (e) {
        throw conflict((e as Error).message);
      }
      const [refund] = await tx
        .insert(refunds)
        .values({
          saleId: item.saleId,
          saleItemId: item.id,
          quantity: input.quantity,
          refundAmountPaise: calc.refundAmountPaise,
          restock: input.restock,
          cogsRestoredPaise: calc.cogsRestoredPaise,
          profitDeltaPaise: calc.profitDeltaPaise,
          reason: input.reason ?? null,
          idempotencyKey: input.idempotencyKey,
          createdBy: input.userId ?? null,
        })
        .returning();
      await tx
        .update(saleItems)
        .set({
          refundedQuantity: item.refundedQuantity + input.quantity,
          refundedAmountPaise: item.refundedAmountPaise + calc.refundAmountPaise,
        })
        .where(eq(saleItems.id, item.id));

      if (input.restock) {
        const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, item.lotId)).for("update");
        await tx.update(inventoryLots).set({ quantityRemaining: lot.quantityRemaining + input.quantity }).where(eq(inventoryLots.id, lot.id));
        await tx.insert(inventoryMovements).values({
          lotId: lot.id,
          variantId: item.variantId,
          type: "refund_restock",
          quantity: input.quantity,
          refType: "refund",
          refId: refund.id,
          note: input.reason,
        });
      } else {
        await tx.insert(inventoryMovements).values({
          lotId: item.lotId,
          variantId: item.variantId,
          type: "write_off",
          quantity: 0,
          refType: "refund",
          refId: refund.id,
          note: `Returned, not restocked${input.reason ? `: ${input.reason}` : ""}`,
        });
      }

      const owners = await tx.select().from(lotOwnershipAllocations).where(eq(lotOwnershipAllocations.lotId, item.lotId));
      const slices = splitProfit(
        calc.profitDeltaPaise,
        owners.map((o) => ({ partnerId: o.partnerId, profitShareBps: o.profitShareBps })),
      );
      await tx.insert(lotProfitAllocations).values(
        slices.map((s) => ({ saleId: item.saleId, saleItemId: item.id, refundId: refund.id, lotId: item.lotId, partnerId: s.partnerId, profitPaise: s.profitPaise })),
      );

      const all = await tx.select().from(saleItems).where(eq(saleItems.saleId, item.saleId));
      const fully = all.every((i) => (i.id === item.id ? item.refundedQuantity + input.quantity : i.refundedQuantity) >= i.quantity);
      await tx.update(sales).set({ status: fully ? "refunded" : "partially_refunded" }).where(eq(sales.id, item.saleId));
      await audit(tx, { userId: input.userId, action: "sale.refund", entity: "sale", entityId: item.saleId, detail: { refundId: refund.id, ...calc, restock: input.restock } });
      return { duplicate: false, refundId: refund.id, profitDeltaPaise: calc.profitDeltaPaise };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const [again] = await db.select().from(refunds).where(eq(refunds.idempotencyKey, input.idempotencyKey));
      if (again) return { duplicate: true, refundId: again.id, profitDeltaPaise: again.profitDeltaPaise };
    }
    throw e;
  }
}

export interface SaleFilter {
  from?: Date;
  to?: Date;
  customerId?: string;
  limit?: number;
}

export async function listSales(db: DB, f: SaleFilter = {}) {
  const conds = [];
  if (f.from) conds.push(gte(sales.saleDate, f.from));
  if (f.to) conds.push(lte(sales.saleDate, f.to));
  if (f.customerId) conds.push(eq(sales.customerId, f.customerId));
  const rows = await db
    .select({ sale: sales, customerName: customers.name })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(sales.saleDate), desc(sales.createdAt))
    .limit(f.limit ?? 200);
  if (!rows.length) return [];
  const items = await db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      quantity: saleItems.quantity,
      unitPricePaise: saleItems.unitPricePaise,
      unitCostPaise: saleItems.unitCostPaise,
      refundedQuantity: saleItems.refundedQuantity,
      refundedAmountPaise: saleItems.refundedAmountPaise,
      name: products.name,
      brand: products.brand,
      size: productVariants.size,
      category: products.category,
    })
    .from(saleItems)
    .innerJoin(productVariants, eq(productVariants.id, saleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(saleItems.saleId, rows.map((r) => r.sale.id)));
  const refundRows = await db.select().from(refunds).where(inArray(refunds.saleId, rows.map((r) => r.sale.id)));
  return rows.map((r) => {
    const refunded = refundRows.filter((x) => x.saleId === r.sale.id);
    const profitDelta = refunded.reduce((a, x) => a + x.profitDeltaPaise, 0);
    return {
      ...r.sale,
      customerName: r.customerName,
      items: items.filter((i) => i.saleId === r.sale.id),
      refundedPaise: refunded.reduce((a, x) => a + x.refundAmountPaise, 0),
      netProfitPaise: r.sale.profitPaise + profitDelta,
    };
  });
}
