import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { inventoryLots, productImports, products } from "@/lib/db/schema";
import { ExtractedProductSchema, extractProduct, saveImport, validateImportUrl, type Extractor } from "@/lib/services/imports";
import { advance, canTransition, createRequest, linkSale, recordPurchaseForRequest } from "@/lib/services/sourcing";
import { createPurchase, listStock } from "@/lib/services/inventory";
import { recordSale } from "@/lib/services/sales";
import { key, testDb } from "./helpers";

let db: DB, userId: string, close: () => Promise<void>;
beforeAll(async () => ({ db, userId, close } = await testDb()));
afterAll(() => close());

describe("product URL import validation (any public website)", () => {
  it.each([
    "https://stockx.com/air-jordan-1",
    "https://www.nike.com/t/air-jordan-1/DZ5485-612",
    "https://some-small-shop.in/products/dunk-low",
    "http://old-shop.example.com/item?id=4",
  ])("accepts %s", (u) => expect(() => validateImportUrl(u)).not.toThrow());

  it.each([
    "https://127.0.0.1/x",
    "https://localhost/x",
    "https://[::1]/x",
    "https://10.0.0.5/admin",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data",
    "https://user:pass@example.com/x",
    "https://intranet.local/x",
    "https://internalhost/x",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "ftp://example.com/x",
    "not a url",
  ])("rejects %s", (u) => expect(() => validateImportUrl(u)).toThrow());
});

describe("product import flow", () => {
  const good: Extractor = async () => ({ title: "Air Jordan 1 High Chicago", brand: "Jordan", sku: "DZ5485-612", colorway: "White/Red", category: "sneakers", retail_price_inr: 16995, market_price_inr: 24000, images: ["https://images.example.com/a.jpg"], sizes: ["9", "10"] });

  it("extracted data is validated with Zod", () => {
    expect(() => ExtractedProductSchema.parse({ title: "" })).toThrow();
    expect(() => ExtractedProductSchema.parse({ title: "x", images: ["http://insecure/x.jpg"] })).toThrow();
    expect(() => ExtractedProductSchema.parse({ title: "x", retail_price_inr: -5 })).toThrow();
  });

  it("failed extraction is recorded and reported", async () => {
    await expect(extractProduct(db, "https://stockx.com/x", userId, async () => ({ nonsense: true }))).rejects.toMatchObject({ status: 422 });
    const rows = await db.select().from(productImports);
    expect(rows.some((r) => r.status === "failed")).toBe(true);
  });

  it("rejects private addresses before calling the extractor", async () => {
    let called = false;
    await expect(extractProduct(db, "https://169.254.169.254/latest", userId, async () => { called = true; return {}; })).rejects.toMatchObject({ status: 400 });
    expect(called).toBe(false);
  });

  it("saving creates a DRAFT product with sizes but no stock, and demands image rights", async () => {
    const { importId, extracted } = await extractProduct(db, "https://stockx.com/jordan-1", userId, good);
    expect(extracted.title).toContain("Chicago");
    const body = { title: extracted.title, category: "sneakers", sizes: ["9", "10"], imageUrls: extracted.images, imageRightsConfirmed: false };
    await expect(saveImport(db, importId, { ...body } as never)).rejects.toMatchObject({ status: 400 });
    const p = await saveImport(db, importId, { ...body, imageRightsConfirmed: true } as never);
    expect(p.status).toBe("draft");
    const lots = await db.select().from(inventoryLots);
    expect(lots.find((l) => l.notes === p.id)).toBeUndefined();
    expect((await listStock(db)).find((s) => s.productId === p.id)).toBeUndefined();
    await expect(saveImport(db, importId, { ...body, imageRightsConfirmed: true } as never)).rejects.toMatchObject({ status: 400 });
    const [row] = await db.select().from(products).where(eq(products.id, p.id));
    expect(row.status).toBe("draft");
  });
});

describe("sourcing request workflow", () => {
  const input = { product: "Jordan 4 Military Black", desiredSize: "9", budgetPaise: 2_500_000, depositPaise: 0, depositReceived: false };

  it("allows only forward single steps (or cancel)", () => {
    expect(canTransition("requested", "sourcing")).toBe(true);
    expect(canTransition("requested", "quoted")).toBe(false);
    expect(canTransition("quoted", "requested")).toBe(false);
    expect(canTransition("confirmed", "cancelled")).toBe(true);
    expect(canTransition("completed", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "sourcing")).toBe(false);
  });

  it("a request is not inventory until a real purchase is recorded", async () => {
    const before = (await listStock(db)).length;
    const r = await createRequest(db, { ...input }, userId);
    expect(r.status).toBe("requested");
    expect((await listStock(db)).length).toBe(before);
    await expect(advance(db, r.id, "confirmed", userId)).rejects.toMatchObject({ code: "conflict" }); // cannot skip
  });

  it("runs the full lifecycle through to a linked sale", async () => {
    const r = await createRequest(db, { ...input, quotedPricePaise: 2_400_000 }, userId);
    await advance(db, r.id, "sourcing", userId);
    await advance(db, r.id, "quoted", userId);
    await advance(db, r.id, "confirmed", userId);
    await expect(advance(db, r.id, "purchased", userId)).rejects.toMatchObject({ status: 400 }); // purchase must be recorded first

    const buy = await recordPurchaseForRequest(
      db, r.id,
      { idempotencyKey: key(), lot: { size: "9", quantity: 1, landed: { foreignCurrency: "USD", foreignUnitPriceMinor: 18_000, fxRate: 84, internationalShippingPaise: 300_000, customsDutyPaise: 400_000, paymentFeesPaise: 50_000 } } },
      userId,
    );
    // 180 USD * 84 = ₹15,120 + 3,000 + 4,000 + 500 = ₹22,620
    expect(buy.unitCostPaise).toBe(2_262_000);
    const stock = (await listStock(db)).find((s) => s.variantId === buy.variantId)!;
    expect(stock.quantity).toBe(1);

    await advance(db, r.id, "delivered", userId).catch(() => null);
    const sale = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: buy.variantId, quantity: 1, unitPricePaise: 2_400_000 }] });
    expect(sale.profitPaise).toBe(2_400_000 - 2_262_000);
    await linkSale(db, r.id, sale.saleId, userId);
    await advance(db, r.id, "delivered", userId).catch(() => null);
    await expect(advance(db, r.id, "completed", userId)).resolves.toMatchObject({ status: "completed" });
  });

  it("purchase can only be recorded for a confirmed request", async () => {
    const r = await createRequest(db, { ...input }, userId);
    await expect(recordPurchaseForRequest(db, r.id, { idempotencyKey: key(), lot: { size: "9", quantity: 1, unitCostPaise: 100 } }, userId)).rejects.toMatchObject({ code: "conflict" });
  });

  it("existing stock is untouched by sourcing lookups", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Unrelated" }, size: "8", quantity: 3, totalCostPaise: 300 });
    expect((await listStock(db)).find((s) => s.variantId === p.variantId)!.quantity).toBe(3);
  });
});
