import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { customers, sourcingRequests, suppliers } from "../db/schema";
import { badRequest, conflict, notFound } from "../errors";
import { lotToPurchase, type LotInputT } from "../schemas";
import { SOURCING_FLOW, canTransition, type SourcingStatus } from "../sourcing-flow";
import { audit } from "./audit";
import { createPurchase } from "./inventory";

export { SOURCING_FLOW, canTransition, type SourcingStatus };

export const SourcingInput = z.object({
  product: z.string().trim().min(2).max(200),
  customerId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  desiredSize: z.string().trim().max(30).nullish(),
  budgetPaise: z.number().int().nonnegative().nullish(),
  quotedPricePaise: z.number().int().nonnegative().nullish(),
  estimatedCostPaise: z.number().int().nonnegative().nullish(),
  depositPaise: z.number().int().nonnegative().default(0),
  depositReceived: z.boolean().default(false),
  deliveryStatus: z.string().trim().max(100).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});
export type SourcingInputT = z.infer<typeof SourcingInput>;

export async function createRequest(db: DB, input: SourcingInputT, userId?: string) {
  const [row] = await db.insert(sourcingRequests).values(input).returning();
  await audit(db, { userId, action: "sourcing.create", entity: "sourcing_request", entityId: row.id });
  return row;
}

export async function updateRequest(db: DB, id: string, patch: Partial<SourcingInputT>, userId?: string) {
  const [row] = await db.update(sourcingRequests).set({ ...patch, updatedAt: new Date() }).where(eq(sourcingRequests.id, id)).returning();
  if (!row) throw notFound("Request not found");
  await audit(db, { userId, action: "sourcing.update", entity: "sourcing_request", entityId: id });
  return row;
}

export async function listRequests(db: DB) {
  return db
    .select({ request: sourcingRequests, customerName: customers.name, supplierName: suppliers.name })
    .from(sourcingRequests)
    .leftJoin(customers, eq(customers.id, sourcingRequests.customerId))
    .leftJoin(suppliers, eq(suppliers.id, sourcingRequests.supplierId))
    .orderBy(desc(sourcingRequests.createdAt))
    .limit(300)
    .then((rows) => rows.map((r) => ({ ...r.request, customerName: r.customerName, supplierName: r.supplierName })));
}

export async function advance(db: DB, id: string, to: SourcingStatus, userId?: string) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(sourcingRequests).where(eq(sourcingRequests.id, id)).for("update");
    if (!r) throw notFound("Request not found");
    if (!canTransition(r.status as SourcingStatus, to)) throw conflict(`Cannot move from ${r.status} to ${to}`);
    if (to === "quoted" && r.quotedPricePaise == null) throw badRequest("Add a quoted price before marking as quoted");
    if (to === "purchased" && !r.lotId) throw badRequest("Record the purchase (cost and size) to mark as purchased");
    if (to === "completed" && !r.saleId) throw badRequest("Link the final sale before completing");
    const [row] = await tx.update(sourcingRequests).set({ status: to, updatedAt: new Date() }).where(eq(sourcingRequests.id, id)).returning();
    await audit(tx, { userId, action: "sourcing.status", entity: "sourcing_request", entityId: id, detail: { from: r.status, to } });
    return row;
  });
}

export interface SourcingPurchaseInput {
  lot: LotInputT;
  brand?: string | null;
  category?: string | null;
  idempotencyKey: string;
}

/** Turn a confirmed request into real owned inventory. Only here does stock come into existence for a request. */
export async function recordPurchaseForRequest(db: DB, id: string, input: SourcingPurchaseInput, userId = "") {
  const [r] = await db.select().from(sourcingRequests).where(eq(sourcingRequests.id, id));
  if (!r) throw notFound("Request not found");
  if (r.status !== "confirmed") throw conflict("Only a confirmed request can be purchased");
  const purchase = lotToPurchase(
    { ...input.lot, supplierId: input.lot.supplierId ?? r.supplierId },
    { name: r.product, brand: input.brand, category: input.category ?? "sneakers" },
    input.idempotencyKey,
    userId,
  );
  const p = await createPurchase(db, { ...purchase, source: "sourcing", createdBy: userId || null, notes: `Sourcing request ${r.id}` });
  await db
    .update(sourcingRequests)
    .set({ lotId: p.lotId, estimatedCostPaise: purchase.totalCostPaise, status: "purchased", updatedAt: new Date() })
    .where(eq(sourcingRequests.id, id));
  return p;
}

export async function linkSale(db: DB, id: string, saleId: string, userId?: string) {
  const [row] = await db.update(sourcingRequests).set({ saleId, updatedAt: new Date() }).where(eq(sourcingRequests.id, id)).returning();
  if (!row) throw notFound("Request not found");
  await audit(db, { userId, action: "sourcing.link_sale", entity: "sourcing_request", entityId: id, detail: { saleId } });
  return row;
}

// suppliers
export const SupplierInput = z.object({
  name: z.string().trim().min(1).max(120),
  country: z.string().trim().max(80).nullish(),
  contact: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});
export const createSupplier = async (db: DB, i: z.infer<typeof SupplierInput>) => (await db.insert(suppliers).values(i).returning())[0];
export const listSuppliers = (db: DB) => db.select().from(suppliers).orderBy(suppliers.name);
