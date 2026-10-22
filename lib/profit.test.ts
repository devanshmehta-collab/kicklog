import { describe, expect, it } from "vitest";
import {
  allocateProportionally,
  computeLandedCost,
  computePurchaseCost,
  computeRefund,
  computeSale,
  splitProfit,
} from "./profit";
import { parseRupeesToPaise } from "./money";

const costs = { discountPaise: 0, shippingRevenuePaise: 0, shippingCostPaise: 0, feesPaise: 0, otherExpensesPaise: 0 };

describe("computeSale", () => {
  it("₹22,000 − ₹18,000 − ₹500 shipping = ₹3,500", () => {
    const t = computeSale([{ quantity: 1, unitPricePaise: 2_200_000, unitCostPaise: 1_800_000 }], { ...costs, shippingCostPaise: 50_000 });
    expect(t.profitPaise).toBe(350_000);
    expect(t.cogsPaise).toBe(1_800_000);
  });
  it("handles discount, buyer-paid shipping, fees without double counting", () => {
    const t = computeSale([{ quantity: 2, unitPricePaise: 1_000_000, unitCostPaise: 600_000 }], {
      discountPaise: 100_000,
      shippingRevenuePaise: 30_000,
      shippingCostPaise: 40_000,
      feesPaise: 20_000,
      otherExpensesPaise: 10_000,
    });
    expect(t.netProceedsPaise).toBe(2_000_000 - 100_000 + 30_000);
    expect(t.profitPaise).toBe(1_930_000 - 1_200_000 - 70_000);
  });
  it("rejects bad input", () => {
    expect(() => computeSale([], costs)).toThrow();
    expect(() => computeSale([{ quantity: 0, unitPricePaise: 1, unitCostPaise: 1 }], costs)).toThrow();
    expect(() => computeSale([{ quantity: 1, unitPricePaise: 100, unitCostPaise: 1 }], { ...costs, discountPaise: 200 })).toThrow();
  });
});

describe("computePurchaseCost", () => {
  it("shipping included is not added twice", () => {
    expect(computePurchaseCost({ amountPaise: 1_800_000, basis: "total", quantity: 1, shippingPaise: 50_000, amountIncludesShipping: true }).totalCostPaise).toBe(1_800_000);
  });
  it("shipping extra is added once", () => {
    expect(computePurchaseCost({ amountPaise: 1_500_000, basis: "total", quantity: 1, shippingPaise: 50_000, amountIncludesShipping: false }).totalCostPaise).toBe(1_550_000);
  });
  it("per-unit vs total", () => {
    const a = computePurchaseCost({ amountPaise: 1_200_000, basis: "per_unit", quantity: 2, amountIncludesShipping: true });
    expect(a.totalCostPaise).toBe(2_400_000);
    expect(a.unitCostPaise).toBe(1_200_000);
    const b = computePurchaseCost({ amountPaise: 2_400_000, basis: "total", quantity: 2, amountIncludesShipping: true });
    expect(b.unitCostPaise).toBe(1_200_000);
  });
});

describe("computeLandedCost", () => {
  it("converts FX and adds duty/shipping/fees", () => {
    const r = computeLandedCost({
      foreignUnitPriceMinor: 20_000, // $200.00
      fxRate: 83.5,
      quantity: 2,
      internationalShippingPaise: 500_000,
      customsDutyPaise: 1_000_000,
      paymentFeesPaise: 100_000,
      domesticShippingPaise: 50_000,
    });
    expect(r.goodsPaise).toBe(2 * 1_670_000);
    expect(r.totalLandedPaise).toBe(3_340_000 + 1_650_000);
  });
  it("does not double count components the invoice already includes", () => {
    const r = computeLandedCost({ inrUnitPricePaise: 1_000_000, quantity: 1, internationalShippingPaise: 100_000, customsDutyPaise: 200_000, invoiceIncludes: { internationalShipping: true } });
    expect(r.totalLandedPaise).toBe(1_200_000);
  });
  it("requires fx rate for foreign prices", () => {
    expect(() => computeLandedCost({ foreignUnitPriceMinor: 100, quantity: 1 })).toThrow();
  });
});

describe("refunds", () => {
  const line = { quantity: 1, unitPricePaise: 2_200_000, unitCostPaise: 1_800_000, discountPaise: 0, refundedQuantity: 0, refundedAmountPaise: 0 };
  it("restocked full refund restores COGS: profit delta = −(price − cost)", () => {
    const r = computeRefund(line, 1, true);
    expect(r.profitDeltaPaise).toBe(-400_000);
  });
  it("damaged return keeps the cost as a loss", () => {
    expect(computeRefund(line, 1, false).profitDeltaPaise).toBe(-2_200_000);
  });
  it("prevents refunding more than sold", () => {
    expect(() => computeRefund({ ...line, refundedQuantity: 1, refundedAmountPaise: 2_200_000 }, 1, true)).toThrow();
    expect(() => computeRefund(line, 1, true, 3_000_000)).toThrow();
  });
});

describe("partner split", () => {
  it("60/40 partner profit share leaves nothing for owner", () => {
    const s = splitProfit(350_000, [{ partnerId: "a", profitShareBps: 6000 }, { partnerId: "b", profitShareBps: 4000 }]);
    expect(s.map((x) => x.profitPaise)).toEqual([210_000, 140_000, 0]);
  });
  it("owner keeps remainder and parts always sum exactly", () => {
    const s = splitProfit(10_001, [{ partnerId: "a", profitShareBps: 3333 }]);
    expect(s.reduce((a, x) => a + x.profitPaise, 0)).toBe(10_001);
    expect(s.at(-1)!.partnerId).toBeNull();
  });
  it("negative profit (refund) splits symmetrically", () => {
    const s = splitProfit(-400_000, [{ partnerId: "a", profitShareBps: 5000 }]);
    expect(s.map((x) => x.profitPaise)).toEqual([-200_000, -200_000]);
  });
  it("rejects >100%", () => {
    expect(() => splitProfit(1, [{ partnerId: "a", profitShareBps: 6000 }, { partnerId: "b", profitShareBps: 6000 }])).toThrow();
  });
  it("allocateProportionally preserves totals", () => {
    expect(allocateProportionally(100, [1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("parseRupeesToPaise", () => {
  it.each([["18k", 1_800_000], ["₹1.2L", 12_000_000], ["6,50,000", 65_000_000], ["2 lakh", 20_000_000]])("%s", (s, p) => {
    expect(parseRupeesToPaise(s as string)).toBe(p);
  });
});
