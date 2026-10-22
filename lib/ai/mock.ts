import type { InterpretRequest, InterpretResult, Interpreter } from "./client";
import type { Interpretation } from "./schema";

/**
 * Deterministic regex "interpreter" used ONLY when AI_MODE=mock (local dev without an API key, and e2e tests).
 * It stands in for Claude's structured output; every downstream rule and financial calculation is the real code path.
 */

const MULT: Record<string, number> = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5 };

function amountAfter(text: string, re: RegExp): number | null {
  const m = text.match(re);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return Math.round(n * (MULT[(m[2] ?? "").toLowerCase()] ?? 1));
}

const AMT = String.raw`(?:₹|rs\.?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(k|lakhs?|lac|l)?\b`;

const STOP = new Set(["sold", "the", "a", "an", "to", "for", "of", "my", "pair", "pairs", "size", "shipping", "ship", "incl", "including", "and", "at", "s", "inr", "rs", "paid", "delivery", "bought", "got", "purchased", "add"]);
const NICK: Record<string, string[]> = { chicago: ["chicago", "aj1", "jordan"], aj1: ["jordan 1", "aj1", "air jordan 1"], aj: ["jordan"], panda: ["panda", "dunk"], lv: ["louis vuitton", "lv"] };

export function mockInterpret(req: InterpretRequest): Interpretation {
  const text = req.text.trim();
  const lower = text.toLowerCase();
  const empty: Interpretation = { type: "unclear", purchase: null, sale: null, confidence: 0.2, questions: [] };

  if (!text && req.images.length) {
    return { ...empty, questions: ["I can't read this image reliably. Please add details or upload a clearer photo."], image_readable: false };
  }
  const isSale = /\b(sold|selling)\b/.test(lower);
  const isBuy = /\b(bought|purchased|got|picked up|restocked)\b/.test(lower);
  if (!isSale && !isBuy) return { ...empty, questions: ["Is this a purchase or a sale? Tell me the item and price."] };

  const sizeM = lower.match(/size\s*(?:uk|us|eu)?\s*(\d+(?:\.\d+)?)/) ?? lower.match(/\b(\d{1,2}(?:\.5)?)s\b/);
  const size = sizeM ? sizeM[1] : null;
  const shipM = amountAfter(lower, new RegExp(String.raw`${AMT}\s*(?:shipping|delivery|ship)`)) ?? amountAfter(lower, new RegExp(String.raw`(?:shipping|delivery)\s*(?:of|:)?\s*${AMT}`));
  const incl = /\bincl(?:uding|uded|\.)?\s*(?:shipping|delivery)|\ball[- ]in\b|\blanded\b/.test(lower);
  const qtyM = lower.match(/\b(\d+)\s*(?:pairs?|pcs|pieces|units)\b/);
  const qty = qtyM ? parseInt(qtyM[1], 10) : 1;
  const each = /\beach\b|\bper (?:pair|piece|unit)\b/.test(lower);

  if (isBuy && !isSale) {
    const price = amountAfter(lower, new RegExp(String.raw`\bfor\s+${AMT}`));
    const nameM = text.match(/(?:bought|purchased|got|picked up)\s+(?:\d+\s+(?:pairs?\s+of\s+)?)?(.+?)(?:\s+size\b|\s+for\b|\s+at\b|,|$)/i);
    const name = nameM?.[1]?.replace(/^the\s+/i, "").trim() || null;
    const cat = /watch|rolex|datejust/i.test(text) ? "watches" : /bag|wallet/i.test(text) ? "bags" : /hoodie|tee|shirt|jacket/i.test(text) ? "apparel" : "sneakers";
    const shippingExtra = shipM != null && !incl;
    return {
      type: "purchase",
      purchase: {
        item: name,
        brand: /jordan|aj\d/i.test(text) ? "Jordan" : /dunk|nike/i.test(text) ? "Nike" : null,
        category: cat,
        size: size ?? (qty ? (cat === "watches" ? (lower.match(/(\d+mm)/)?.[1] ?? null) : null) : null),
        condition: /used|pre-?owned/.test(lower) ? "used" : "new",
        quantity: qty,
        cost_inr: price,
        amount_basis: qty > 1 ? (each ? "per_unit" : null) : "total",
        shipping_inr: shipM,
        cost_includes_shipping: incl ? true : shippingExtra ? false : shipM == null ? true : null,
        purchase_date: null,
      },
      sale: null,
      confidence: name && price != null ? 0.93 : 0.5,
      questions: [],
    };
  }

  // sale
  const price = amountAfter(lower, new RegExp(String.raw`\bfor\s+${AMT}`));
  const tokens = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^\d+k?$/.test(t) && !/^\d+s$/.test(t));
  const needles = new Set(tokens.flatMap((t) => NICK[t] ?? [t]));
  const score = (s: (typeof req.stock)[number]) => {
    const hay = `${s.name} ${s.brand ?? ""} ${s.colorway ?? ""} ${s.sku ?? ""}`.toLowerCase();
    return [...needles].filter((n) => hay.includes(n)).length;
  };
  let pool = req.stock;
  if (size) pool = pool.filter((s) => s.size.replace(/\D*/, "") === size || s.size === size);
  const nameTokens = tokens.filter((t) => !["sold", "to"].includes(t));
  const scored = pool.map((s) => ({ s, sc: nameTokens.length ? score(s) : 0 }));
  const best = Math.max(0, ...scored.map((x) => x.sc));
  const candidates = nameTokens.length ? scored.filter((x) => x.sc > 0 && x.sc === best).map((x) => x.s) : size ? pool : [];
  const matched = candidates.length === 1 ? candidates[0].id : null;
  return {
    type: "sale",
    purchase: null,
    sale: {
      matched_item_id: matched,
      other_possible_ids: candidates.length > 1 ? candidates.map((c) => c.id) : [],
      quantity: qty,
      price_inr: price,
      price_basis: qty > 1 ? (each ? "per_unit" : "total") : "total",
      shipping_inr: shipM,
      fees_inr: null,
      sale_date: null,
      customer_name: null,
    },
    confidence: matched && price != null ? 0.93 : 0.5,
    questions: matched ? [] : candidates.length > 1 ? ["Which item did you sell?"] : ["I couldn't find that item in stock. Which item was it?"],
  };
}

export const mockInterpreter: Interpreter = async (req): Promise<InterpretResult> => {
  const parsed = mockInterpret(req);
  return { parsed, raw: { mock: true }, model: "mock" };
};
