import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { inventoryLots, inventoryMovements, lotProfitAllocations, partners, reviewQueue, sales, saleItems } from "@/lib/db/schema";
import { listStock, createPurchase } from "@/lib/services/inventory";
import { recordSale, refundSaleItem } from "@/lib/services/sales";
import { confirmReview, discardReview, listReviews } from "@/lib/services/reviews";
import type { Interpreter } from "@/lib/ai/client";
import { key, log, testDb } from "./helpers";

let db: DB, userId: string, close: () => Promise<void>;
beforeAll(async () => ({ db, userId, close } = await testDb()));
afterAll(() => close());

const totals = async () => {
  const [r] = await db.select({ profit: sql<number>`coalesce(sum(profit_paise),0)::float8` }).from(sales);
  return { profit: r.profit, stock: (await listStock(db)).reduce((a, s) => a + s.quantity, 0) };
};
const movementCount = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(inventoryMovements))[0].n;

describe("Quick Log: purchase and sale (non-negotiable tests 1 and 2)", () => {
  it("logs a purchase from one sentence, shipping included once", async () => {
    const out = await log(db, userId, "Bought AJ1 Chicago size 10 for ₹18,000 incl shipping.");
    expect(out.status).toBe("saved");
    const stock = await listStock(db);
    expect(stock).toHaveLength(1);
    expect(stock[0]).toMatchObject({ name: "AJ1 Chicago", size: "10", quantity: 1, avgUnitCostPaise: 1_800_000 });
  });

  it("logs the sale, matches the exact unit and realises ₹3,500", async () => {
    const before = await totals();
    const out = await log(db, userId, "Sold the Chicago 10s for ₹22,000, ₹500 shipping.");
    expect(out.status).toBe("saved");
    expect(out.profitPaise).toBe(350_000);
    const after = await totals();
    expect(after.profit - before.profit).toBe(350_000);
    expect(after.stock).toBe(before.stock - 1);
  });
});

describe("Quick Log: bad input (test 3) changes nothing and creates review records", () => {
  it.each([["hello"], ["Sold the Yeezy 350 for 15k"]])("%s", async (text) => {
    const before = await totals();
    const mv = await movementCount();
    const out = await log(db, userId, text);
    expect(out.status).toBe("needs_review");
    expect(out.reviewId).toBeTruthy();
    expect(await totals()).toEqual(before);
    expect(await movementCount()).toBe(mv);
  });

  it("unreadable receipt photo goes to review, nothing saved", async () => {
    const before = await totals();
    const blurry: Interpreter = async () => ({
      model: "test",
      raw: {},
      parsed: { type: "purchase", purchase: { item: null, size: null, cost_inr: null }, sale: null, confidence: 0.2, questions: ["Please upload a clearer photo"], image_readable: false },
    });
    const out = await log(db, userId, "", { interpreter: blurry, images: [{ mediaType: "image/jpeg", base64: "AAAA" }] });
    expect(out.status).toBe("needs_review");
    expect(out.problems?.join(" ")).toMatch(/clearer photo|could not be read/i);
    expect(await totals()).toEqual(before);
  });

  it("'Sold the size 10s' with two size-10 products is ambiguous and keeps both candidates", async () => {
    await log(db, userId, "Bought Panda Dunks size 10 for ₹12,000 incl shipping");
    await log(db, userId, "Bought Travis Jordan 1 size 10 for ₹40,000 incl shipping");
    const before = await totals();
    const out = await log(db, userId, "Sold the size 10s");
    expect(out.status).toBe("needs_review");
    const [rev] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, out.reviewId!));
    expect(rev.candidates.length).toBe(2);
    expect(await totals()).toEqual(before);
  });
});

describe("rules: shipping, cost, photo", () => {
  it("shipping that is extra is added to the cost exactly once", async () => {
    const stub: Interpreter = async () => ({
      model: "t",
      raw: {},
      parsed: { type: "purchase", purchase: { item: "Blue Jordans", category: "sneakers", size: "8", quantity: 1, cost_inr: 15000, amount_basis: "total", shipping_inr: 500, cost_includes_shipping: false }, sale: null, confidence: 0.95, questions: [] },
    });
    await log(db, userId, "Got the blue Jordans for 15k and paid 500 delivery", { interpreter: stub });
    const row = (await listStock(db)).find((s) => s.name === "Blue Jordans")!;
    expect(row.avgUnitCostPaise).toBe(1_550_000);
  });

  it("shipping with unknown treatment goes to review (never guessed)", async () => {
    const stub: Interpreter = async () => ({
      model: "t",
      raw: {},
      parsed: { type: "purchase", purchase: { item: "Dunk Low", category: "sneakers", size: "9", cost_inr: 10000, shipping_inr: 400, cost_includes_shipping: null }, sale: null, confidence: 0.95, questions: [] },
    });
    expect((await log(db, userId, "x", { interpreter: stub })).status).toBe("needs_review");
  });

  it("missing cost or low confidence goes to review", async () => {
    const noCost: Interpreter = async () => ({ model: "t", raw: {}, parsed: { type: "purchase", purchase: { item: "Dunk", category: "sneakers", size: "9" }, sale: null, confidence: 0.95, questions: [] } });
    expect((await log(db, userId, "x", { interpreter: noCost })).status).toBe("needs_review");
    const low: Interpreter = async () => ({ model: "t", raw: {}, parsed: { type: "purchase", purchase: { item: "Dunk", category: "sneakers", size: "9", cost_inr: 9000 }, sale: null, confidence: 0.6, questions: [] } });
    expect((await log(db, userId, "x", { interpreter: low })).status).toBe("needs_review");
  });

  it("photo plus text with mocked AI output saves a purchase", async () => {
    const photo: Interpreter = async (req) => {
      expect(req.images).toHaveLength(1);
      return { model: "t", raw: {}, parsed: { type: "purchase", purchase: { item: "Nike SB Dunk Low", brand: "Nike", category: "sneakers", size: "10", cost_inr: 18000, cost_includes_shipping: true }, sale: null, confidence: 0.9, questions: [] } };
    };
    const out = await log(db, userId, "Bought this pair for 18k, size 10", { interpreter: photo, images: [{ mediaType: "image/jpeg", base64: "AAAA" }] });
    expect(out.status).toBe("saved");
  });

  it("an AI failure preserves the original submission in review", async () => {
    const broken: Interpreter = async () => {
      throw new Error("model exploded");
    };
    const before = await totals();
    const out = await log(db, userId, "Bought something for 5k", { interpreter: broken });
    expect(out.status).toBe("needs_review");
    expect(out.aiFailed).toBe(true);
    const [rev] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, out.reviewId!));
    expect(rev.inputText).toBe("Bought something for 5k");
    expect(await totals()).toEqual(before);
  });
});

describe("idempotency", () => {
  it("retrying the same request key does not duplicate a purchase", async () => {
    const k = key();
    const a = await log(db, userId, "Bought Test Idem Shoe size 7 for 5k incl shipping", { key: k });
    const b = await log(db, userId, "Bought Test Idem Shoe size 7 for 5k incl shipping", { key: k });
    expect(a.status).toBe("saved");
    expect(b.duplicate).toBe(true);
    const rows = (await listStock(db)).filter((s) => s.name === "Test Idem Shoe");
    expect(rows[0].quantity).toBe(1);
  });

  it("concurrent identical requests only act once", async () => {
    const k = key();
    await Promise.all([
      log(db, userId, "Bought Race Shoe size 8 for 5k incl shipping", { key: k }),
      log(db, userId, "Bought Race Shoe size 8 for 5k incl shipping", { key: k }),
    ]);
    const rows = (await listStock(db)).filter((s) => s.name === "Race Shoe");
    expect(rows[0].quantity).toBe(1);
  });
});

describe("concurrency and rollback", () => {
  it("only one of several concurrent sales of the last unit succeeds", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Last Unit" }, size: "9", quantity: 1, totalCostPaise: 100_000 });
    const attempt = (n: number) =>
      recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 200_000 + n }] }).then(
        () => "ok",
        (e) => e.code ?? "err",
      );
    const results = await Promise.all([attempt(1), attempt(2), attempt(3)]);
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect(results.filter((r) => r === "conflict")).toHaveLength(2);
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, p.lotId));
    expect(lot.quantityRemaining).toBe(0);
  });

  it("a failing multi-line sale rolls back everything", async () => {
    const a = await createPurchase(db, { idempotencyKey: key(), product: { name: "Rollback A" }, size: "9", quantity: 1, totalCostPaise: 100_000 });
    const b = await createPurchase(db, { idempotencyKey: key(), product: { name: "Rollback B" }, size: "9", quantity: 1, totalCostPaise: 100_000 });
    const salesBefore = (await db.select().from(sales)).length;
    await expect(
      recordSale(db, {
        idempotencyKey: key(),
        lines: [
          { variantId: a.variantId, quantity: 1, unitPricePaise: 300_000 },
          { variantId: b.variantId, quantity: 2, unitPricePaise: 300_000 },
        ],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await db.select().from(sales)).length).toBe(salesBefore);
    const [lotA] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, a.lotId));
    expect(lotA.quantityRemaining).toBe(1);
  });

  it("inventory can never go negative (DB check constraint)", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Neg" }, size: "9", quantity: 1, totalCostPaise: 1 });
    await expect(db.update(inventoryLots).set({ quantityRemaining: -1 }).where(eq(inventoryLots.id, p.lotId))).rejects.toBeTruthy();
  });
});

describe("refunds", () => {
  it("restocked refund restores stock and reverses profit once", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Refund Shoe" }, size: "9", quantity: 1, totalCostPaise: 1_800_000 });
    const s = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 2_200_000 }], costs: { shippingCostPaise: 50_000 } });
    expect(s.profitPaise).toBe(350_000);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, s.saleId));
    const rk = key();
    const r1 = await refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: true, idempotencyKey: rk, userId });
    expect(r1.profitDeltaPaise).toBe(-400_000);
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, p.lotId));
    expect(lot.quantityRemaining).toBe(1);
    expect((await refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: true, idempotencyKey: rk, userId })).duplicate).toBe(true);
    await expect(refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: true, idempotencyKey: key(), userId })).rejects.toMatchObject({ code: "conflict" });
    const [sale] = await db.select().from(sales).where(eq(sales.id, s.saleId));
    expect(sale.status).toBe("refunded");
  });

  it("a damaged return does not restock", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Damaged Shoe" }, size: "9", quantity: 1, totalCostPaise: 1_000_000 });
    const s = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 1_500_000 }] });
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, s.saleId));
    await refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: false, idempotencyKey: key(), userId });
    const [lot] = await db.select().from(inventoryLots).where(eq(inventoryLots.id, p.lotId));
    expect(lot.quantityRemaining).toBe(0);
  });
});

describe("partner profit splitting", () => {
  it("allocates 60/40 on sale and reverses on refund", async () => {
    const [a, b] = await db.insert(partners).values([{ name: "A" }, { name: "B" }]).returning();
    const p = await createPurchase(db, {
      idempotencyKey: key(),
      product: { name: "Partner Shoe" },
      size: "9",
      quantity: 1,
      totalCostPaise: 1_000_000,
      partners: [
        { partnerId: a.id, ownershipBps: 5000, profitShareBps: 6000 },
        { partnerId: b.id, ownershipBps: 3000, profitShareBps: 4000 },
      ],
    });
    const s = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 1_500_000 }] });
    const rows = await db.select().from(lotProfitAllocations).where(eq(lotProfitAllocations.saleId, s.saleId));
    const by = (id: string | null) => rows.filter((r) => r.partnerId === id).reduce((x, r) => x + r.profitPaise, 0);
    expect(by(a.id)).toBe(300_000);
    expect(by(b.id)).toBe(200_000);
    expect(by(null)).toBe(0);
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, s.saleId));
    await refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: true, idempotencyKey: key(), userId });
    const after = await db.select().from(lotProfitAllocations).where(eq(lotProfitAllocations.saleId, s.saleId));
    expect(after.reduce((x, r) => x + r.profitPaise, 0)).toBe(0);
  });
});

describe("needs-review confirmation", () => {
  it("edited fields are re-validated, then saved; double confirm is safe", async () => {
    const stub: Interpreter = async () => ({ model: "t", raw: {}, parsed: { type: "purchase", purchase: { item: "Review Shoe", category: "sneakers", size: "9", cost_inr: null }, sale: null, confidence: 0.9, questions: [] } });
    const out = await log(db, userId, "bought review shoe", { interpreter: stub });
    expect(out.status).toBe("needs_review");
    await expect(confirmReview(db, out.reviewId!, { userId })).rejects.toMatchObject({ status: 422 });
    const fields = { type: "purchase" as const, purchase: { item: "Review Shoe", category: "sneakers", size: "9", cost_inr: 7000, cost_includes_shipping: true }, sale: null };
    const [c1] = await Promise.all([confirmReview(db, out.reviewId!, { fields, userId }), confirmReview(db, out.reviewId!, { fields, userId }).catch((e) => e)]);
    expect(c1.result.kind).toBe("purchase");
    const rows = (await listStock(db)).filter((s) => s.name === "Review Shoe");
    expect(rows[0].quantity).toBe(1);
    expect((await listReviews(db, "open")).find((r) => r.id === out.reviewId)).toBeUndefined();
  });

  it("confirming a sale for an item that is not in stock is refused", async () => {
    const out = await log(db, userId, "Sold the Nonexistent for 10k");
    const fields = { type: "sale" as const, purchase: null, sale: { matched_item_id: "00000000-0000-0000-0000-000000000000", price_inr: 10000 } };
    await expect(confirmReview(db, out.reviewId!, { fields, userId })).rejects.toMatchObject({ status: 422 });
    await discardReview(db, out.reviewId!, userId);
  });
});
