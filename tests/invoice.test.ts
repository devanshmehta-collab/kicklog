import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { DB } from "@/lib/db";
import { saleItems } from "@/lib/db/schema";
import { createPurchase } from "@/lib/services/inventory";
import { getInvoice, invoiceNumber, prettyPhone } from "@/lib/services/invoice";
import { recordSale, refundSaleItem } from "@/lib/services/sales";
import { saveSettings } from "@/lib/services/settings";
import { key, testDb } from "./helpers";

let db: DB, userId: string, close: () => Promise<void>;
beforeAll(async () => ({ db, userId, close } = await testDb()));
afterAll(() => close());

const COST = 1_234_567; // a distinctive per-unit cost, so a leak is easy to spot

describe("customer invoice", () => {
  it("shows what the buyer pays, with discount and shipping, and nothing about your cost or profit", async () => {
    await saveSettings(db, { businessName: "Test Store", phone: "+91 90000 00000", address: "12 High Street, Mumbai", invoiceNote: "Thanks!" });
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Invoice Dunk", brand: "Nike" }, size: "9", quantity: 3, totalCostPaise: COST * 3 });
    const sale = await recordSale(db, {
      idempotencyKey: key(),
      lines: [{ variantId: p.variantId, quantity: 2, unitPricePaise: 2_000_000 }],
      customer: { name: "Asha Rao", phone: "+91 98765 43210", city: "Pune" },
      costs: { discountPaise: 100_000, shippingRevenuePaise: 50_000, shippingCostPaise: 77_777, feesPaise: 33_333, otherExpensesPaise: 11_111 },
    });
    const inv = await getInvoice(db, sale.saleId);

    expect(inv.lines).toEqual([{ description: "Invoice Dunk", size: "9", quantity: 2, unitPricePaise: 2_000_000, totalPaise: 4_000_000, refundedQuantity: 0 }]);
    expect(inv).toMatchObject({ subtotalPaise: 4_000_000, discountPaise: 100_000, shippingPaise: 50_000, totalPaise: 3_950_000, refundedPaise: 0, netPaidPaise: 3_950_000 });
    expect(inv.buyer).toMatchObject({ name: "Asha Rao", city: "Pune" });
    expect(inv.seller).toMatchObject({ name: "Test Store", address: "12 High Street, Mumbai", note: "Thanks!" });

    const text = JSON.stringify(inv);
    for (const secret of [String(COST), "77777", "33333", "11111", String(sale.profitPaise), "cogs", "profit", "unitCost", "fees", "margin"]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("numbers invoices sequentially and never reuses a number", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Seq Shoe" }, size: "8", quantity: 3, totalCostPaise: 300 });
    const a = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 500 }] });
    const b = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 500 }] });
    const [ia, ib] = [await getInvoice(db, a.saleId), await getInvoice(db, b.saleId)];
    expect(ia.number).toMatch(/^INV-\d{4}$/);
    expect(parseInt(ib.number.slice(4))).toBe(parseInt(ia.number.slice(4)) + 1);
    expect(invoiceNumber(7)).toBe("INV-0007");
  });

  it("a repeated request (same key) is the same sale and the same invoice number", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Dup Shoe" }, size: "8", quantity: 1, totalCostPaise: 100 });
    const k = key();
    const one = await recordSale(db, { idempotencyKey: k, lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 900 }] });
    const two = await recordSale(db, { idempotencyKey: k, lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 900 }] });
    expect(two.saleId).toBe(one.saleId);
    expect((await getInvoice(db, one.saleId)).number).toBe((await getInvoice(db, two.saleId)).number);
  });

  it("shows refunds and the net amount actually kept", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Refund Invoice Shoe" }, size: "9", quantity: 2, totalCostPaise: 2000 });
    const sale = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 2, unitPricePaise: 10_000 }] });
    const [item] = await db.select().from(saleItems).where(eq(saleItems.saleId, sale.saleId));
    await refundSaleItem(db, { saleItemId: item.id, quantity: 1, restock: true, idempotencyKey: key(), userId });
    const inv = await getInvoice(db, sale.saleId);
    expect(inv.totalPaise).toBe(20_000);
    expect(inv.refundedPaise).toBe(10_000);
    expect(inv.netPaidPaise).toBe(10_000);
    expect(inv.lines[0].refundedQuantity).toBe(1);
  });

  it("a walk-in sale with no customer still produces an invoice", async () => {
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Walk In Shoe" }, size: "9", quantity: 1, totalCostPaise: 100 });
    const sale = await recordSale(db, { idempotencyKey: key(), lines: [{ variantId: p.variantId, quantity: 1, unitPricePaise: 500 }] });
    expect((await getInvoice(db, sale.saleId)).buyer).toEqual({ name: "", phone: "", city: "", instagram: "" });
  });

  it("formats phone numbers for printing", () => {
    expect(prettyPhone("919059312317")).toBe("+91 90593 12317");
    expect(prettyPhone("9059312317")).toBe("+91 90593 12317");
    expect(prettyPhone("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(prettyPhone("")).toBe("");
  });

  it("an unknown sale is a 404", async () => {
    await expect(getInvoice(db, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ status: 404 });
  });
});
