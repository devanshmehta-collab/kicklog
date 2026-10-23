import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { inventoryLots, productImports, productVariants, products } from "@/lib/db/schema";
import { getPublicProduct, listPublicProducts } from "@/lib/services/catalog";
import { createPurchase, listStock } from "@/lib/services/inventory";
import { ImportSaveSchema, saveImport } from "@/lib/services/imports";
import { key, testDb } from "./helpers";

let db: DB, userId: string, close: () => Promise<void>;
beforeAll(async () => ({ db, userId, close } = await testDb()));
afterAll(() => close());

const newImport = async (url = "https://shop.example.com/p/1") => (await db.insert(productImports).values({ url, status: "extracted", createdBy: userId }).returning())[0].id;
const parse = (x: object) => ImportSaveSchema.parse({ title: "Imported Dunk", category: "sneakers", sizes: [], ...x });

describe("import with stock and publish", () => {
  it("units entered become real stock lots with the cost you gave, and the product is published", async () => {
    const id = await newImport();
    const p = await saveImport(
      db,
      id,
      parse({ title: "Import Stock Dunk", sizes: ["9", "10", "11"], publicPricePaise: 1_500_000, lots: [{ size: "9", quantity: 2, unitCostPaise: 1_000_000 }, { size: "10", quantity: 1, unitCostPaise: 1_100_000 }], publish: true }),
    );
    expect(p.status).toBe("published");
    const stock = (await listStock(db)).filter((s) => s.productId === p.id);
    expect(stock.map((s) => [s.size, s.quantity, s.avgUnitCostPaise]).sort()).toEqual([["10", 1, 1_100_000], ["9", 2, 1_000_000]]);
    const variants = await db.select().from(productVariants).where(eq(productVariants.productId, p.id));
    expect(variants.map((v) => v.size).sort()).toEqual(["10", "11", "9"]); // size 11: listed, but no stock entered
    const live = await getPublicProduct(db, p.id);
    expect(live.sizes).toEqual(["9", "10"]); // only sizes actually in stock
    expect((await listPublicProducts(db)).some((x) => x.id === p.id)).toBe(true);
  });

  it("without stock or publish it stays a private draft with no inventory", async () => {
    const p = await saveImport(db, await newImport(), parse({ title: "Import Draft Only", sizes: ["9"], publicPricePaise: 100 }));
    expect(p.status).toBe("draft");
    expect((await listStock(db)).some((s) => s.productId === p.id)).toBe(false);
  });

  it("refuses to publish without a price or without any units", async () => {
    await expect(saveImport(db, await newImport(), parse({ title: "No Price", publish: true, lots: [{ size: "9", quantity: 1, unitCostPaise: 1 }] }))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/public price/) });
    await expect(saveImport(db, await newImport(), parse({ title: "No Units", publish: true, publicPricePaise: 100 }))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/at least one unit/) });
    expect((await db.select().from(products).where(eq(products.name, "No Price"))).length).toBe(0); // nothing half-saved
  });

  it("stock lands on the imported product even if another product has the same name", async () => {
    const older = await createPurchase(db, { idempotencyKey: key(), product: { name: "Twin Name Shoe" }, size: "8", quantity: 1, totalCostPaise: 100 });
    const p = await saveImport(db, await newImport(), parse({ title: "Twin Name Shoe", sizes: ["9"], lots: [{ size: "9", quantity: 3, unitCostPaise: 500 }] }));
    expect(p.id).not.toBe(older.productId);
    const lots = await db.select().from(inventoryLots);
    const mine = lots.filter((l) => l.quantityAcquired === 3);
    const variant = (await db.select().from(productVariants).where(eq(productVariants.id, mine[0].variantId)))[0];
    expect(variant.productId).toBe(p.id);
  });

  it("is atomic: a bad stock line leaves no product behind", async () => {
    const id = await newImport();
    await expect(saveImport(db, id, parse({ title: "Atomic Shoe", lots: [{ size: "9", quantity: 1, unitCostPaise: 1 }, { size: "9", quantity: 2, unitCostPaise: 1 }] }))).rejects.toMatchObject({ status: 400 });
    expect((await db.select().from(products).where(eq(products.name, "Atomic Shoe"))).length).toBe(0);
    expect((await db.select().from(productImports).where(eq(productImports.id, id)))[0].productId).toBeNull();
  });

  it("validates stock input", () => {
    expect(() => parse({ lots: [{ size: "9", quantity: 0, unitCostPaise: 1 }] })).toThrow();
    expect(() => parse({ lots: [{ size: "9", quantity: 1, unitCostPaise: -5 }] })).toThrow();
    expect(() => parse({ lots: [{ size: "9", quantity: 1.5, unitCostPaise: 5 }] })).toThrow();
  });
});
