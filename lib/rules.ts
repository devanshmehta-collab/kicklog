import { computePurchaseCost } from "./profit";
import { rupeesToPaise } from "./money";
import type { Interpretation, ReviewFields } from "./ai/schema";

/**
 * Deterministic business validation. Decides whether an interpreted transaction may be
 * saved automatically, must go to the Needs Review queue, or (in confirm mode) is valid to save.
 * No AI, no database — pure and easily testable.
 */

export const AUTO_SAVE_CONFIDENCE = 0.85;
const MAX_QTY = 1000;
const MAX_RUPEES = 50_000_000; // ₹5 crore per amount

export interface StockCandidate {
  variantId: string;
  name: string;
  brand: string | null;
  size: string;
  quantity: number;
  colorway?: string | null;
  sku?: string | null;
}

export interface PurchaseAction {
  kind: "purchase";
  product: { name: string; brand: string | null; category: string; condition: string; colorway: string | null };
  size: string;
  quantity: number;
  totalCostPaise: number;
  unitCostPaise: number;
  shippingPaise: number;
  purchaseDate: Date | null;
}

export interface SaleAction {
  kind: "sale";
  variantId: string;
  quantity: number;
  unitPricePaise: number;
  shippingCostPaise: number;
  feesPaise: number;
  saleDate: Date | null;
  customerName: string | null;
}

export interface Evaluation {
  /** auto = safe to save now · review = needs a human · invalid = cannot be saved even by a human as-is */
  decision: "auto" | "review";
  type: "purchase" | "sale" | "unclear";
  problems: string[];
  missing: string[];
  candidates: StockCandidate[];
  /** Present only when decision === "auto" (or mode "confirm" with no problems). */
  action?: PurchaseAction | SaleAction;
}

export interface EvalContext {
  stock: StockCandidate[];
  today: Date;
  /** "auto": apply the confidence gate. "confirm": a human has reviewed — skip the confidence gate only. */
  mode: "auto" | "confirm";
}

const SIZED = /sneak|shoe|footwear|trainer|boot|apparel|cloth|hood|tee|shirt|jacket|jersey|pant|jean|sweat/i;

export function categoryNeedsSize(category: string | null | undefined): boolean {
  if (!category) return true;
  return SIZED.test(category);
}

function parseDate(s: string | null | undefined, today: Date, problems: string[]): Date | null {
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    problems.push(`Date "${s}" is not valid`);
    return null;
  }
  if (d.getTime() > today.getTime() + 36 * 3600_000) problems.push("Date is in the future");
  return d;
}

function validAmount(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= MAX_RUPEES;
}

const isPositive = (n: number | null | undefined): n is number => validAmount(n) && n > 0;

function evalPurchase(i: ReviewFields, confidence: number, ctx: EvalContext): Evaluation {
  const p = i.purchase ?? {};
  const problems: string[] = [];
  const missing: string[] = [];

  const name = p.item?.trim();
  if (!name) missing.push("Product name");
  const category = p.category?.trim() || null;
  const size = p.size?.trim() || null;
  if (!size && categoryNeedsSize(category)) missing.push("Size");

  const qty = p.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) problems.push("Quantity must be a whole number between 1 and 1000");

  if (p.cost_inr == null) missing.push("Purchase cost");
  else if (!validAmount(p.cost_inr)) problems.push("Purchase cost is out of range");
  else if (ctx.mode === "auto" && p.cost_inr === 0) problems.push("Purchase cost is zero");

  if (p.shipping_inr != null && !validAmount(p.shipping_inr)) problems.push("Shipping amount is out of range");

  const shipping = p.shipping_inr ?? 0;
  if (shipping > 0 && p.cost_includes_shipping == null) {
    problems.push("Is the ₹" + shipping + " shipping included in the cost or extra?");
    missing.push("Shipping treatment");
  }
  if (qty > 1 && p.amount_basis == null) {
    problems.push("Is the cost per unit or the total for all " + qty + " units?");
    missing.push("Per-unit or total cost");
  }
  const purchaseDate = parseDate(p.purchase_date, ctx.today, problems);

  if (ctx.mode === "auto") {
    if (i.type !== "purchase") problems.push("Not classified as a purchase");
    if (confidence < AUTO_SAVE_CONFIDENCE) problems.push(`AI confidence ${confidence.toFixed(2)} is below ${AUTO_SAVE_CONFIDENCE}`);
  }

  if (missing.length || problems.length || !name || p.cost_inr == null) {
    return { decision: "review", type: "purchase", problems, missing: [...new Set(missing)], candidates: [] };
  }

  const cost = computePurchaseCost({
    amountPaise: rupeesToPaise(p.cost_inr),
    basis: qty === 1 ? "total" : (p.amount_basis ?? "total"),
    quantity: qty,
    shippingPaise: rupeesToPaise(shipping),
    amountIncludesShipping: p.cost_includes_shipping ?? true,
  });
  return {
    decision: "auto",
    type: "purchase",
    problems,
    missing,
    candidates: [],
    action: {
      kind: "purchase",
      product: {
        name: name,
        brand: p.brand?.trim() || null,
        category: category ?? "sneakers",
        condition: p.condition?.trim() || "new",
        colorway: p.colorway?.trim() || null,
      },
      size: size ?? "OS",
      quantity: qty,
      totalCostPaise: cost.totalCostPaise,
      unitCostPaise: cost.unitCostPaise,
      shippingPaise: cost.shippingPaise,
      purchaseDate,
    },
  };
}

function evalSale(i: ReviewFields, confidence: number, ctx: EvalContext): Evaluation {
  const s = i.sale ?? {};
  const problems: string[] = [];
  const missing: string[] = [];
  const byId = new Map(ctx.stock.map((c) => [c.variantId, c]));

  const matchedId = s.matched_item_id?.trim() || null;
  const others = (s.other_possible_ids ?? []).filter((id) => id !== matchedId);
  const candidateIds = [...new Set([...(matchedId ? [matchedId] : []), ...others])];
  const candidates = candidateIds.map((id) => byId.get(id)).filter((c): c is StockCandidate => !!c);
  let item: StockCandidate | undefined;

  if (!matchedId) {
    missing.push("Which item was sold");
    problems.push(
      candidates.length > 1
        ? `${candidates.length} items could match — pick the right one`
        : "No item in stock matches this sale",
    );
  } else if (!byId.has(matchedId)) {
    problems.push("The matched item is not in stock (or does not exist)");
    missing.push("Which item was sold");
  } else if (others.some((id) => byId.has(id)) && ctx.mode === "auto") {
    problems.push("More than one item plausibly matches — pick the right one");
  } else {
    item = byId.get(matchedId);
  }

  const qty = s.quantity ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) problems.push("Quantity must be a whole number between 1 and 1000");
  else if (item && qty > item.quantity) problems.push(`Only ${item.quantity} in stock, sale says ${qty}`);

  if (s.price_inr == null) missing.push("Sale price");
  else if (!validAmount(s.price_inr)) problems.push("Sale price is out of range");
  else if (ctx.mode === "auto" && s.price_inr === 0) problems.push("Sale price is zero");
  for (const [label, v] of [["Shipping", s.shipping_inr], ["Fees", s.fees_inr]] as const) {
    if (v != null && !validAmount(v)) problems.push(`${label} amount is out of range`);
  }
  if (qty > 1 && s.price_basis == null && s.price_inr != null) {
    problems.push(`Is the price per unit or the total for all ${qty} units?`);
    missing.push("Per-unit or total price");
  }
  const saleDate = parseDate(s.sale_date, ctx.today, problems);

  if (ctx.mode === "auto") {
    if (i.type !== "sale") problems.push("Not classified as a sale");
    if (confidence < AUTO_SAVE_CONFIDENCE) problems.push(`AI confidence ${confidence.toFixed(2)} is below ${AUTO_SAVE_CONFIDENCE}`);
  }

  if (!item || problems.length || missing.length || s.price_inr == null) {
    return { decision: "review", type: "sale", problems, missing: [...new Set(missing)], candidates };
  }
  const unitPrice = qty > 1 && s.price_basis === "total" ? s.price_inr / qty : s.price_inr;
  return {
    decision: "auto",
    type: "sale",
    problems,
    missing,
    candidates,
    action: {
      kind: "sale",
      variantId: item.variantId,
      quantity: qty,
      unitPricePaise: rupeesToPaise(unitPrice),
      shippingCostPaise: rupeesToPaise(s.shipping_inr ?? 0),
      feesPaise: rupeesToPaise(s.fees_inr ?? 0),
      saleDate,
      customerName: s.customer_name?.trim() || null,
    },
  };
}

export function evaluate(
  interp: ReviewFields & { confidence?: number; image_readable?: boolean | null; questions?: string[] },
  ctx: EvalContext,
): Evaluation {
  const confidence = interp.confidence ?? 0;
  const imageProblem = interp.image_readable === false && ctx.mode === "auto" ? ["The attached image could not be read reliably"] : [];

  let result: Evaluation;
  if (interp.type === "purchase") result = evalPurchase(interp, confidence, ctx);
  else if (interp.type === "sale") result = evalSale(interp, confidence, ctx);
  else {
    result = {
      decision: "review",
      type: "unclear",
      problems: ["Couldn't tell whether this is a purchase or a sale"],
      missing: ["Transaction type"],
      candidates: [],
    };
  }
  if (imageProblem.length) {
    result = { ...result, decision: "review", problems: [...result.problems, ...imageProblem], action: undefined };
  }
  if (ctx.mode === "auto" && interp.questions?.length) {
    // The model asking questions is a strong signal a human should look, even at high confidence.
    if (result.decision === "auto" && confidence < 0.95) {
      result = { ...result, decision: "review", problems: [...result.problems, ...interp.questions], action: undefined };
    } else if (result.decision === "review") {
      result = { ...result, problems: [...new Set([...result.problems, ...interp.questions])] };
    }
  }
  return result;
}

/** Narrow a full Interpretation to what the review queue stores. */
export function toReviewFields(i: Interpretation): ReviewFields {
  return { type: i.type, purchase: i.purchase ?? null, sale: i.sale ?? null };
}
