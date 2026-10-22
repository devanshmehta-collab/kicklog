import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db";
import { addProductImage, createPurchase, deleteProductImage, getProductDetail, setPrimaryImage } from "@/lib/services/inventory";
import { key, testDb } from "./helpers";

let db: DB, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("product photo management", () => {
  it("first photo is the cover; any photo can be made the cover; deleting the cover promotes the next", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Photo Shoe" }, size: "9", quantity: 1, totalCostPaise: 100 });
    const a = await addProductImage(db, p.productId, "/api/files/p-a.jpg");
    const b = await addProductImage(db, p.productId, "/api/files/p-b.jpg");
    const c = await addProductImage(db, p.productId, "/api/files/p-c.jpg");
    let d = await getProductDetail(db, p.productId);
    expect(d.images.map((i) => i.url)[0]).toBe("/api/files/p-a.jpg");
    expect(a.isPrimary).toBe(true);

    await setPrimaryImage(db, p.productId, c.id);
    d = await getProductDetail(db, p.productId);
    expect(d.images[0].id).toBe(c.id);
    expect(d.images.filter((i) => i.isPrimary)).toHaveLength(1);

    await deleteProductImage(db, p.productId, c.id);
    d = await getProductDetail(db, p.productId);
    expect(d.images).toHaveLength(2);
    expect(d.images.filter((i) => i.isPrimary)).toHaveLength(1);
    expect([a.id, b.id]).toContain(d.images[0].id);
  });

  it("cannot touch another product's photo", async () => {
    const p1 = await createPurchase(db, { idempotencyKey: key(), product: { name: "Owner Shoe" }, size: "9", quantity: 1, totalCostPaise: 100 });
    const p2 = await createPurchase(db, { idempotencyKey: key(), product: { name: "Other Shoe" }, size: "9", quantity: 1, totalCostPaise: 100 });
    const img = await addProductImage(db, p1.productId, "/api/files/p-z.jpg");
    await expect(deleteProductImage(db, p2.productId, img.id)).rejects.toMatchObject({ status: 404 });
    await expect(setPrimaryImage(db, p2.productId, img.id)).rejects.toMatchObject({ status: 404 });
  });
});
