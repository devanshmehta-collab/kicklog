/**
 * Deterministic financial maths. Everything is integer paise.
 * The AI never touches these numbers.
 *
 *   Net proceeds  = Σ(unit price × qty) − discount + shipping charged to the buyer
 *   Profit        = Net proceeds − COGS − (outbound shipping + platform fees + other selling expenses)
 */

export interface SaleLine {
  quantity: number;
  unitPricePaise: number;
  unitCostPaise: number;
}

export interface SaleCosts {
  discountPaise: number;
  shippingRevenuePaise: number;
  shippingCostPaise: number;
  feesPaise: number;
  otherExpensesPaise: number;
}

export const NO_COSTS: SaleCosts = {
  discountPaise: 0,
  shippingRevenuePaise: 0,
  shippingCostPaise: 0,
  feesPaise: 0,
  otherExpensesPaise: 0,
};

export interface SaleTotals {
  grossRevenuePaise: number;
  netProceedsPaise: number;
  cogsPaise: number;
  sellingExpensesPaise: number;
  profitPaise: number;
  lineDiscountsPaise: number[];
}

/** Split `total` across `weights` with the largest-remainder method so the parts always sum exactly. */
export function allocateProportionally(total: number, weights: number[]): number[] {
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0 || abs === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (abs * w) / sum);
  const floors = raw.map(Math.floor);
  let rest = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  return floors.map((v) => v * sign);
}

export function computeSale(lines: SaleLine[], costs: SaleCosts): SaleTotals {
  if (lines.length === 0) throw new Error("A sale needs at least one line");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) throw new Error("Quantity must be a positive integer");
    if (l.unitPricePaise < 0 || l.unitCostPaise < 0) throw new Error("Amounts cannot be negative");
  }
  for (const v of Object.values(costs)) {
    if (!Number.isInteger(v) || v < 0) throw new Error("Costs must be non-negative integer paise");
  }

  const lineGross = lines.map((l) => l.quantity * l.unitPricePaise);
  const grossRevenuePaise = lineGross.reduce((a, b) => a + b, 0);
  if (costs.discountPaise > grossRevenuePaise) throw new Error("Discount cannot exceed the sale value");
  const lineDiscountsPaise = allocateProportionally(costs.discountPaise, lineGross);
  const netProceedsPaise = grossRevenuePaise - costs.discountPaise + costs.shippingRevenuePaise;
  const cogsPaise = lines.reduce((a, l) => a + l.quantity * l.unitCostPaise, 0);
  const sellingExpensesPaise = costs.shippingCostPaise + costs.feesPaise + costs.otherExpensesPaise;
  return {
    grossRevenuePaise,
    netProceedsPaise,
    cogsPaise,
    sellingExpensesPaise,
    profitPaise: netProceedsPaise - cogsPaise - sellingExpensesPaise,
    lineDiscountsPaise,
  };
}

export interface RefundLine {
  quantity: number;
  unitPricePaise: number;
  unitCostPaise: number;
  discountPaise: number;
  refundedQuantity: number;
  refundedAmountPaise: number;
}

export interface RefundResult {
  refundAmountPaise: number;
  cogsRestoredPaise: number;
  profitDeltaPaise: number;
  maxRefundablePaise: number;
}

/**
 * Refund maths for one sale line.
 * Money returned to the buyer reduces revenue and profit one-for-one. If the goods go back on the shelf
 * their cost is un-expensed (COGS restored); damaged goods are written off, so the cost stays as a loss.
 * Outbound shipping and fees already paid are sunk and are not reversed.
 */
export function computeRefund(
  line: RefundLine,
  quantity: number,
  restock: boolean,
  requestedAmountPaise?: number,
): RefundResult {
  const remainingQty = line.quantity - line.refundedQuantity;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Refund quantity must be a positive integer");
  if (quantity > remainingQty) throw new Error("Refund quantity exceeds units still sold");
  const lineNet = line.quantity * line.unitPricePaise - line.discountPaise;
  const maxRefundablePaise = lineNet - line.refundedAmountPaise;
  const defaultAmount =
    quantity === remainingQty ? maxRefundablePaise : Math.floor((lineNet / line.quantity) * quantity);
  const refundAmountPaise = requestedAmountPaise ?? defaultAmount;
  if (!Number.isInteger(refundAmountPaise) || refundAmountPaise < 0) throw new Error("Invalid refund amount");
  if (refundAmountPaise > maxRefundablePaise) throw new Error("Refund exceeds the amount received for this item");
  const cogsRestoredPaise = restock ? quantity * line.unitCostPaise : 0;
  return {
    refundAmountPaise,
    cogsRestoredPaise,
    profitDeltaPaise: -refundAmountPaise + cogsRestoredPaise,
    maxRefundablePaise,
  };
}

export interface ShareRule {
  partnerId: string;
  profitShareBps: number;
}

export interface ProfitSlice {
  partnerId: string | null; // null = owner's retained share
  profitPaise: number;
}

/** Divide (possibly negative) profit between partners and the owner's retained remainder. */
export function splitProfit(profitPaise: number, shares: ShareRule[]): ProfitSlice[] {
  const totalBps = shares.reduce((a, s) => a + s.profitShareBps, 0);
  if (totalBps > 10000) throw new Error("Profit shares exceed 100%");
  const weights = [...shares.map((s) => s.profitShareBps), 10000 - totalBps];
  const parts = allocateProportionally(profitPaise, weights);
  const out: ProfitSlice[] = shares.map((s, i) => ({ partnerId: s.partnerId, profitPaise: parts[i] }));
  out.push({ partnerId: null, profitPaise: parts[parts.length - 1] });
  return out;
}

export interface PurchaseCostInput {
  /** Amount the user quoted. */
  amountPaise: number;
  /** Whether the quoted amount is per unit or for the whole quantity. */
  basis: "per_unit" | "total";
  quantity: number;
  shippingPaise?: number;
  /** true → shipping already inside amountPaise; false → add it on top. */
  amountIncludesShipping: boolean;
}

export interface PurchaseCost {
  totalCostPaise: number;
  unitCostPaise: number;
  shippingPaise: number;
}

/** Landed purchase cost. Never double-counts shipping that is already inside the quoted amount. */
export function computePurchaseCost(i: PurchaseCostInput): PurchaseCost {
  if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw new Error("Quantity must be a positive integer");
  const shipping = i.shippingPaise ?? 0;
  const goods = i.basis === "per_unit" ? i.amountPaise * i.quantity : i.amountPaise;
  const totalCostPaise = i.amountIncludesShipping ? goods : goods + shipping;
  return { totalCostPaise, unitCostPaise: Math.round(totalCostPaise / i.quantity), shippingPaise: shipping };
}

export interface LandedCostInput {
  /** Foreign price per unit in minor units (e.g. cents). */
  foreignUnitPriceMinor?: number;
  /** INR per 1 major foreign unit. */
  fxRate?: number;
  /** Use instead of the foreign fields when the supplier invoice is already in INR. */
  inrUnitPricePaise?: number;
  quantity: number;
  internationalShippingPaise?: number;
  customsDutyPaise?: number;
  paymentFeesPaise?: number;
  domesticShippingPaise?: number;
  /** Components already folded into the supplier invoice must not be added twice. */
  invoiceIncludes?: {
    internationalShipping?: boolean;
    customsDuty?: boolean;
    paymentFees?: boolean;
    domesticShipping?: boolean;
  };
}

export interface LandedCost {
  goodsPaise: number;
  extrasPaise: number;
  totalLandedPaise: number;
  unitLandedPaise: number;
}

export function computeLandedCost(i: LandedCostInput): LandedCost {
  if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw new Error("Quantity must be a positive integer");
  let unitGoods: number;
  if (i.foreignUnitPriceMinor != null) {
    if (!i.fxRate || i.fxRate <= 0) throw new Error("Exchange rate required for foreign-currency purchases");
    unitGoods = Math.round((i.foreignUnitPriceMinor / 100) * i.fxRate * 100);
  } else if (i.inrUnitPricePaise != null) {
    unitGoods = i.inrUnitPricePaise;
  } else {
    throw new Error("Supplier price required");
  }
  const goodsPaise = unitGoods * i.quantity;
  const inc = i.invoiceIncludes ?? {};
  const extrasPaise =
    (inc.internationalShipping ? 0 : (i.internationalShippingPaise ?? 0)) +
    (inc.customsDuty ? 0 : (i.customsDutyPaise ?? 0)) +
    (inc.paymentFees ? 0 : (i.paymentFeesPaise ?? 0)) +
    (inc.domesticShipping ? 0 : (i.domesticShippingPaise ?? 0));
  const totalLandedPaise = goodsPaise + extrasPaise;
  return { goodsPaise, extrasPaise, totalLandedPaise, unitLandedPaise: Math.round(totalLandedPaise / i.quantity) };
}
