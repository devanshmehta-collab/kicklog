import { describe, expect, it } from "vitest";
import { evaluate, type StockCandidate } from "./rules";
import type { Interpretation } from "./ai/schema";

const today = new Date("2026-10-22T10:00:00Z");
const stock: StockCandidate[] = [
  { variantId: "v-chi-10", name: "AJ1 Chicago", brand: "Jordan", size: "10", quantity: 1 },
  { variantId: "v-panda-10", name: "Dunk Low Panda", brand: "Nike", size: "10", quantity: 2 },
  { variantId: "v-bred-9", name: "AJ4 Bred", brand: "Jordan", size: "9", quantity: 1 },
];
const ev = (i: Partial<Interpretation> & Pick<Interpretation, "type">, mode: "auto" | "confirm" = "auto") =>
  evaluate({ confidence: 0.95, questions: [], ...i }, { stock, today, mode });

describe("purchase auto-save gate", () => {
  const ok = { item: "AJ1 Chicago", category: "sneakers", size: "10", quantity: 1, cost_inr: 18000, cost_includes_shipping: true };
  it("saves when everything is explicit", () => {
    const r = ev({ type: "purchase", purchase: ok });
    expect(r.decision).toBe("auto");
    expect(r.action).toMatchObject({ kind: "purchase", totalCostPaise: 1_800_000, unitCostPaise: 1_800_000, size: "10" });
  });
  it("needs review below 0.85 confidence", () => {
    expect(ev({ type: "purchase", purchase: ok, confidence: 0.84 }).decision).toBe("review");
    expect(ev({ type: "purchase", purchase: ok, confidence: 0.85 }).decision).toBe("auto");
  });
  it("needs review when cost, size or name is missing", () => {
    expect(ev({ type: "purchase", purchase: { ...ok, cost_inr: null } }).missing).toContain("Purchase cost");
    expect(ev({ type: "purchase", purchase: { ...ok, size: null } }).missing).toContain("Size");
    expect(ev({ type: "purchase", purchase: { ...ok, item: "" } }).missing).toContain("Product name");
  });
  it("a bag or watch without a size is fine, sneakers are not", () => {
    expect(ev({ type: "purchase", purchase: { ...ok, category: "bags", size: null } }).decision).toBe("auto");
    expect(ev({ type: "purchase", purchase: { ...ok, category: "sneakers", size: null } }).decision).toBe("review");
  });
  it("never guesses whether shipping is included", () => {
    const r = ev({ type: "purchase", purchase: { ...ok, shipping_inr: 500, cost_includes_shipping: null } });
    expect(r.decision).toBe("review");
  });
  it("extra shipping is added once; included shipping is not", () => {
    expect(ev({ type: "purchase", purchase: { ...ok, cost_inr: 15000, shipping_inr: 500, cost_includes_shipping: false } }).action).toMatchObject({ totalCostPaise: 1_550_000 });
    expect(ev({ type: "purchase", purchase: { ...ok, cost_inr: 15000, shipping_inr: 500, cost_includes_shipping: true } }).action).toMatchObject({ totalCostPaise: 1_500_000 });
  });
  it("quantity > 1 needs per-unit/total clarity, then multiplies", () => {
    expect(ev({ type: "purchase", purchase: { ...ok, quantity: 2, cost_inr: 12000, amount_basis: null } }).decision).toBe("review");
    const r = ev({ type: "purchase", purchase: { ...ok, quantity: 2, cost_inr: 12000, amount_basis: "per_unit" } });
    expect(r.action).toMatchObject({ totalCostPaise: 2_400_000, unitCostPaise: 1_200_000, quantity: 2 });
  });
  it("rejects invalid quantities and future dates", () => {
    expect(ev({ type: "purchase", purchase: { ...ok, quantity: 0 } }).decision).toBe("review");
    expect(ev({ type: "purchase", purchase: { ...ok, quantity: 1.5 } }).decision).toBe("review");
    expect(ev({ type: "purchase", purchase: { ...ok, purchase_date: "2030-01-01" } }).decision).toBe("review");
  });
});

describe("sale auto-save gate", () => {
  const ok = { matched_item_id: "v-chi-10", quantity: 1, price_inr: 22000, shipping_inr: 500 };
  it("saves a unique, in-stock match", () => {
    const r = ev({ type: "sale", sale: ok });
    expect(r.decision).toBe("auto");
    expect(r.action).toMatchObject({ kind: "sale", variantId: "v-chi-10", unitPricePaise: 2_200_000, shippingCostPaise: 50_000, feesPaise: 0 });
  });
  it("two plausible matches → review with both candidates, never auto-picked", () => {
    const r = ev({ type: "sale", sale: { matched_item_id: null, other_possible_ids: ["v-chi-10", "v-panda-10"], price_inr: 20000 } });
    expect(r.decision).toBe("review");
    expect(r.candidates).toHaveLength(2);
  });
  it("matched id plus other possibilities is still ambiguous", () => {
    expect(ev({ type: "sale", sale: { ...ok, other_possible_ids: ["v-panda-10"] } }).decision).toBe("review");
  });
  it("fabricated item ids are rejected", () => {
    const r = ev({ type: "sale", sale: { ...ok, matched_item_id: "made-up-id" } });
    expect(r.decision).toBe("review");
    expect(r.problems.join(" ")).toMatch(/not in stock/);
  });
  it("not in stock → review, not an invented purchase", () => {
    const r = ev({ type: "sale", sale: { matched_item_id: null, other_possible_ids: [], price_inr: 15000 } });
    expect(r.decision).toBe("review");
    expect(r.action).toBeUndefined();
  });
  it("quantity above stock → review", () => {
    expect(ev({ type: "sale", sale: { ...ok, quantity: 2 } }).decision).toBe("review");
  });
  it("missing price → review; unset shipping defaults to zero", () => {
    expect(ev({ type: "sale", sale: { ...ok, price_inr: null } }).missing).toContain("Sale price");
    expect(ev({ type: "sale", sale: { matched_item_id: "v-chi-10", price_inr: 22000 } }).action).toMatchObject({ shippingCostPaise: 0 });
  });
});

describe("unclear, unreadable and confirm mode", () => {
  it('"hello" is unclear', () => {
    const r = ev({ type: "unclear", confidence: 0.1 });
    expect(r.decision).toBe("review");
    expect(r.type).toBe("unclear");
  });
  it("unreadable image forces review even at high confidence", () => {
    const r = ev({ type: "purchase", purchase: { item: "AJ1", category: "sneakers", size: "10", cost_inr: 18000 }, image_readable: false });
    expect(r.decision).toBe("review");
  });
  it("confirm mode ignores confidence but not missing data", () => {
    expect(ev({ type: "purchase", purchase: { item: "AJ1", category: "sneakers", size: "10", cost_inr: 18000, cost_includes_shipping: true }, confidence: 0.2 }, "confirm").decision).toBe("auto");
    expect(ev({ type: "purchase", purchase: { item: "AJ1", category: "sneakers", size: "10" }, confidence: 1 }, "confirm").decision).toBe("review");
  });
  it("confirm mode lets a human resolve an ambiguous sale by choosing the item", () => {
    expect(ev({ type: "sale", sale: { matched_item_id: "v-panda-10", other_possible_ids: ["v-chi-10"], price_inr: 12000 } }, "confirm").decision).toBe("auto");
  });
});
