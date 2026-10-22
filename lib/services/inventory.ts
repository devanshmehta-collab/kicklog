import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import type { DB, Tx } from "../db";
import {
  inventoryLots,
  inventoryMovements,
  lotOwnershipAllocations,
  productImages,
  productVariants,
  products,
  purchaseTransactions,
} from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { audit } from "./audit";

export function normalizeKey(...parts: (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeSize(size: string | null | undefined): string {
  const s = (size ?? "").trim();
  if (!s) return "OS";
  return s.replace(/^(uk|us|eu)\s*/i, (m) => m.toUpperCase().trim() + " ").trim();
}

export function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === "23505" || err?.cause?.code === "23505";
}

export interface ProductFields {
  name: string;
  brand?: string | null;
  category?: string | null;
  model?: string | null;
  colorway?: string | null;
  sku?: string | null;
  condition?: string | null;
  description?: string | null;
  retailPricePaise?: number | null;
  publicPricePaise?: number | null;
}

export async function findOrCreateProduct(tx: Tx, f: ProductFields) {
  const matchKey = normalizeKey(f.name);
  if (!matchKey) throw badRequest("Product name is required");
  const existing = await tx
    .select()
    .from(products)
    .where(and(eq(products.matchKey, matchKey), sql`${products.status} <> 'archived'`))
    .limit(1);
  if (existing[0]) return existing[0];
  const [created] = await tx
    .insert(products)
    .values({
      name: f.name.trim(),
      brand: f.brand ?? null,
      category: f.category ?? "sneakers",
      model: f.model ?? null,
      colorway: f.colorway ?? null,
      sku: f.sku ?? null,
      condition: f.condition ?? "new",
      description: f.description ?? null,
      retailPricePaise: f.retailPricePaise ?? null,
      publicPricePaise: f.publicPricePaise ?? null,
      matchKey,
    })
    .returning();
  return created;
}

export async function findOrCreateVariant(tx: Tx, productId: string, size: string) {
  const s = normalizeSize(size);
  const found = await tx
    .select()
    .from(productVariants)
    .where(and(eq(productVariants.productId, productId), eq(productVariants.size, s)))
    .limit(1);
  if (found[0]) return found[0];
  const [created] = await tx.insert(productVariants).values({ productId, size: s }).returning();
  return created;
}

export interface PurchaseInput {
  idempotencyKey: string;
  product: ProductFields;
  size: string;
  quantity: number;
  /** Fully landed cost of the whole lot (see computePurchaseCost / computeLandedCost). */
  totalCostPaise: number;
  shippingPaise?: number;
  purchaseDate?: Date;
  supplierId?: string | null;
  landed?: {
    countryOfOrigin?: string | null;
    foreignCurrency?: string | null;
    foreignUnitPriceMinor?: number | null;
    fxRate?: number | null;
    internationalShippingPaise?: number | null;
    customsDutyPaise?: number | null;
    paymentFeesPaise?: number | null;
    domesticShippingPaise?: number | null;
  };
  partners?: { partnerId: string; ownershipBps: number; profitShareBps: number }[];
  source?: "manual" | "ai" | "sourcing";
  aiRequestId?: string | null;
  reviewId?: string | null;
  createdBy?: string | null;
  notes?: string | null;
}

export interface PurchaseResult {
  duplicate: boolean;
  lotId: string;
  variantId: string;
  productId: string;
  purchaseId: string;
  unitCostPaise: number;
}

export function validatePartnerShares(partners: NonNullable<PurchaseInput["partners"]>) {
  const own = partners.reduce((a, p) => a + p.ownershipBps, 0);
  const prof = partners.reduce((a, p) => a + p.profitShareBps, 0);
  if (own > 10000 || prof > 10000) throw badRequest("Partner ownership and profit shares cannot exceed 100%");
  if (new Set(partners.map((p) => p.partnerId)).size !== partners.length) throw badRequest("Duplicate partner on lot");
}

async function findPurchaseByKey(db: DB, key: string): Promise<PurchaseResult | null> {
  const [row] = await db
    .select({
      id: purchaseTransactions.id,
      lotId: purchaseTransactions.lotId,
      variantId: inventoryLots.variantId,
      productId: productVariants.productId,
      unit: inventoryLots.unitCostPaise,
    })
    .from(purchaseTransactions)
    .innerJoin(inventoryLots, eq(inventoryLots.id, purchaseTransactions.lotId))
    .innerJoin(productVariants, eq(productVariants.id, inventoryLots.variantId))
    .where(eq(purchaseTransactions.idempotencyKey, key));
  return row
    ? { duplicate: true, lotId: row.lotId, variantId: row.variantId, productId: row.productId, purchaseId: row.id, unitCostPaise: row.unit }
    : null;
}

/** Record a purchase: product → variant → lot → movement → purchase record, atomically and idempotently. */
export async function createPurchase(db: DB, input: PurchaseInput): Promise<PurchaseResult> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) throw badRequest("Quantity must be a positive whole number");
  if (!Number.isInteger(input.totalCostPaise) || input.totalCostPaise < 0) throw badRequest("Cost must be a non-negative amount");
  if (input.partners) validatePartnerShares(input.partners);

  const prior = await findPurchaseByKey(db, input.idempotencyKey);
  if (prior) return prior;

  try {
    return await db.transaction(async (tx) => {
      const product = await findOrCreateProduct(tx, input.product);
      const variant = await findOrCreateVariant(tx, product.id, input.size);
      const unitCostPaise = Math.round(input.totalCostPaise / input.quantity);
      const l = input.landed ?? {};
      const [lot] = await tx
        .insert(inventoryLots)
        .values({
          variantId: variant.id,
          supplierId: input.supplierId ?? null,
          quantityAcquired: input.quantity,
          quantityRemaining: input.quantity,
          unitCostPaise,
          purchaseDate: input.purchaseDate ?? new Date(),
          source: input.source ?? "manual",
          countryOfOrigin: l.countryOfOrigin ?? null,
          foreignCurrency: l.foreignCurrency ?? null,
          foreignUnitPriceMinor: l.foreignUnitPriceMinor ?? null,
          fxRate: l.fxRate != null ? String(l.fxRate) : null,
          internationalShippingPaise: l.internationalShippingPaise ?? null,
          customsDutyPaise: l.customsDutyPaise ?? null,
          paymentFeesPaise: l.paymentFeesPaise ?? null,
          domesticShippingPaise: l.domesticShippingPaise ?? null,
          notes: input.notes ?? null,
        })
        .returning();
      await tx.insert(inventoryMovements).values({
        lotId: lot.id,
        variantId: variant.id,
        type: "purchase",
        quantity: input.quantity,
        refType: "lot",
        refId: lot.id,
        note: `Acquired ${input.quantity} @ ${unitCostPaise} paise`,
      });
      const [purchase] = await tx
        .insert(purchaseTransactions)
        .values({
          lotId: lot.id,
          idempotencyKey: input.idempotencyKey,
          totalCostPaise: input.totalCostPaise,
          shippingPaise: input.shippingPaise ?? 0,
          quantity: input.quantity,
          source: input.source ?? "manual",
          aiRequestId: input.aiRequestId ?? null,
          reviewId: input.reviewId ?? null,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      if (input.partners?.length) {
        await tx.insert(lotOwnershipAllocations).values(input.partners.map((p) => ({ ...p, lotId: lot.id })));
      }
      await audit(tx, {
        userId: input.createdBy,
        action: "purchase.create",
        entity: "inventory_lot",
        entityId: lot.id,
        detail: { source: input.source ?? "manual", aiRequestId: input.aiRequestId, reviewId: input.reviewId, totalCostPaise: input.totalCostPaise },
      });
      return { duplicate: false, lotId: lot.id, variantId: variant.id, productId: product.id, purchaseId: purchase.id, unitCostPaise };
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await findPurchaseByKey(db, input.idempotencyKey);
      if (again) return again;
    }
    throw e;
  }
}

export interface StockRow {
  variantId: string;
  productId: string;
  name: string;
  brand: string | null;
  category: string;
  colorway: string | null;
  sku: string | null;
  condition: string;
  size: string;
  quantity: number;
  /** Cost of units still on hand (private). */
  costValuePaise: number;
  avgUnitCostPaise: number;
  publicPricePaise: number | null;
  status: string;
  imageUrl: string | null;
  oldestPurchase: Date | null;
}

export interface StockFilter {
  q?: string;
  category?: string;
  brand?: string;
  status?: string;
  includeEmpty?: boolean;
}

export async function listStock(db: DB, f: StockFilter = {}): Promise<StockRow[]> {
  const conds = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(products.name, like), ilike(products.brand, like), ilike(products.sku, like), ilike(products.colorway, like)));
  }
  if (f.category) conds.push(eq(products.category, f.category));
  if (f.brand) conds.push(eq(products.brand, f.brand));
  if (f.status) conds.push(eq(products.status, f.status as "draft"));
  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      name: products.name,
      brand: products.brand,
      category: products.category,
      colorway: products.colorway,
      sku: products.sku,
      condition: products.condition,
      size: productVariants.size,
      quantity: sql<number>`coalesce(sum(${inventoryLots.quantityRemaining}), 0)::int`,
      costValuePaise: sql<number>`coalesce(sum(${inventoryLots.quantityRemaining} * ${inventoryLots.unitCostPaise}), 0)::float8`,
      publicPricePaise: products.publicPricePaise,
      status: products.status,
      oldestPurchase: sql<Date | null>`min(case when ${inventoryLots.quantityRemaining} > 0 then ${inventoryLots.purchaseDate} end)`,
      imageUrl: sql<string | null>`(select url from product_images pi where pi.product_id = ${products.id} order by pi.is_primary desc, pi.position asc limit 1)`,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .leftJoin(inventoryLots, eq(inventoryLots.variantId, productVariants.id))
    .where(conds.length ? and(...conds) : undefined)
    .groupBy(productVariants.id, products.id)
    .orderBy(desc(products.createdAt), asc(productVariants.size));
  return rows
    .filter((r) => f.includeEmpty || r.quantity > 0)
    .map((r) => ({
      ...r,
      avgUnitCostPaise: r.quantity > 0 ? Math.round(r.costValuePaise / r.quantity) : 0,
      oldestPurchase: r.oldestPurchase ? new Date(r.oldestPurchase) : null,
    }));
}

/** Lock a variant's lots in FIFO order. Must be called inside a transaction. */
export async function lockLotsFifo(tx: Tx, variantId: string, lotId?: string) {
  const lots = await tx
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.variantId, variantId), gt(inventoryLots.quantityRemaining, 0), lotId ? eq(inventoryLots.id, lotId) : undefined))
    .orderBy(asc(inventoryLots.purchaseDate), asc(inventoryLots.createdAt), asc(inventoryLots.id))
    .for("update");
  return lots;
}

export interface AdjustInput {
  lotId: string;
  /** Signed change in units. */
  delta: number;
  reason: string;
  userId?: string | null;
}

/** Validated manual stock correction. Stock can never go negative. */
export async function adjustStock(db: DB, input: AdjustInput) {
  if (!Number.isInteger(input.delta) || input.delta === 0) throw badRequest("Adjustment must be a non-zero whole number");
  if (!input.reason.trim()) throw badRequest("A reason is required for stock adjustments");
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, input.lotId)).for("update");
    if (!lot) throw notFound("Lot not found");
    const newRemaining = lot.quantityRemaining + input.delta;
    if (newRemaining < 0) throw conflict("Adjustment would make stock negative");
    const newAcquired = input.delta > 0 ? lot.quantityAcquired + input.delta : lot.quantityAcquired;
    await tx
      .update(inventoryLots)
      .set({ quantityRemaining: newRemaining, quantityAcquired: newAcquired })
      .where(eq(inventoryLots.id, lot.id));
    await tx.insert(inventoryMovements).values({
      lotId: lot.id,
      variantId: lot.variantId,
      type: input.delta > 0 ? "adjustment" : "write_off",
      quantity: input.delta,
      refType: "adjustment",
      note: input.reason,
    });
    await audit(tx, { userId: input.userId, action: "inventory.adjust", entity: "inventory_lot", entityId: lot.id, detail: { delta: input.delta, reason: input.reason } });
    return { lotId: lot.id, quantityRemaining: newRemaining };
  });
}

export async function listLots(db: DB, variantId: string) {
  return db.select().from(inventoryLots).where(eq(inventoryLots.variantId, variantId)).orderBy(asc(inventoryLots.purchaseDate));
}

export async function listMovements(db: DB, limit = 100) {
  return db
    .select({
      id: inventoryMovements.id,
      type: inventoryMovements.type,
      quantity: inventoryMovements.quantity,
      note: inventoryMovements.note,
      createdAt: inventoryMovements.createdAt,
      productName: products.name,
      size: productVariants.size,
    })
    .from(inventoryMovements)
    .innerJoin(productVariants, eq(productVariants.id, inventoryMovements.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .orderBy(desc(inventoryMovements.createdAt))
    .limit(limit);
}

export async function updateProduct(db: DB, id: string, patch: Partial<ProductFields> & { status?: "draft" | "published" | "archived" }, userId?: string | null) {
  const values: Record<string, unknown> = { updatedAt: new Date() };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) values[k] = v;
  if (patch.name) values.matchKey = normalizeKey(patch.name);
  const [row] = await db.update(products).set(values).where(eq(products.id, id)).returning();
  if (!row) throw notFound("Product not found");
  await audit(db, { userId, action: "product.update", entity: "product", entityId: id, detail: patch });
  return row;
}

export async function addProductImage(db: DB, productId: string, url: string, makePrimary = false) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productImages)
    .where(eq(productImages.productId, productId));
  const primary = makePrimary || n === 0;
  if (primary) await db.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId));
  const [img] = await db.insert(productImages).values({ productId, url, position: n, isPrimary: primary }).returning();
  return img;
}

export async function getProductDetail(db: DB, productId: string) {
  const [product] = await db.select().from(products).where(eq(products.id, productId));
  if (!product) throw notFound("Product not found");
  const images = await db.select().from(productImages).where(eq(productImages.productId, productId)).orderBy(desc(productImages.isPrimary), asc(productImages.position));
  const variants = await db.select().from(productVariants).where(eq(productVariants.productId, productId));
  const lots = variants.length
    ? await db.select().from(inventoryLots).where(inArray(inventoryLots.variantId, variants.map((v) => v.id))).orderBy(desc(inventoryLots.purchaseDate))
    : [];
  return { product, images, variants, lots };
}
