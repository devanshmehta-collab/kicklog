import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { aiLogRequests } from "../db/schema";
import { AppError } from "../errors";
import type { InterpretImage, Interpreter } from "../ai/client";
import type { PromptStockRow } from "../ai/prompt";
import { evaluate, toReviewFields, type StockCandidate } from "../rules";
import { formatINR } from "../money";
import { isUniqueViolation } from "./inventory";
import { executeAction, loadStockCandidates } from "./execute";
import { createReview } from "./reviews";

export const MAX_PROMPT_STOCK = 200;

export interface QuickLogInput {
  text: string;
  images: InterpretImage[];
  imageKeys: string[];
  idempotencyKey: string;
  userId: string;
  interpreter: Interpreter;
  now?: Date;
}

export interface QuickLogOutcome {
  status: "saved" | "needs_review" | "duplicate_in_progress";
  requestId: string;
  reviewId?: string;
  kind?: "purchase" | "sale" | "unclear";
  message: string;
  profitPaise?: number;
  problems?: string[];
  aiFailed?: boolean;
  /** Server-measured processing time. */
  elapsedMs: number;
  duplicate?: boolean;
}

/**
 * Pick the stock rows to show the model. Small inventories are sent whole. For big ones we rank by token
 * overlap with the message, but keep every row that shares ANY token plus the size, and flag the list as partial
 * so the model never believes an absent item does not exist.
 */
export function selectPromptStock(all: StockCandidate[], text: string): { rows: PromptStockRow[]; truncated: boolean } {
  const toRow = (s: StockCandidate): PromptStockRow => ({
    id: s.variantId,
    name: s.name,
    brand: s.brand,
    size: s.size,
    quantity: s.quantity,
    colorway: s.colorway,
    sku: s.sku,
  });
  if (all.length <= MAX_PROMPT_STOCK) return { rows: all.map(toRow), truncated: false };
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
  const scored = all.map((s) => {
    const hay = `${s.name} ${s.brand ?? ""} ${s.colorway ?? ""} ${s.sku ?? ""} size ${s.size}`.toLowerCase();
    return { s, score: tokens.filter((t) => hay.includes(t)).length };
  });
  scored.sort((a, b) => b.score - a.score);
  return { rows: scored.slice(0, MAX_PROMPT_STOCK).map((x) => toRow(x.s)), truncated: true };
}

async function findRequest(db: DB, key: string) {
  const [r] = await db.select().from(aiLogRequests).where(eq(aiLogRequests.idempotencyKey, key));
  return r;
}

export async function runQuickLog(db: DB, input: QuickLogInput): Promise<QuickLogOutcome> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const now = input.now ?? new Date();

  // ── idempotency: a retry returns what the first attempt produced ──
  const prior = await findRequest(db, input.idempotencyKey);
  if (prior) return replay(prior, elapsed());

  let request: typeof aiLogRequests.$inferSelect;
  try {
    [request] = await db
      .insert(aiLogRequests)
      .values({ userId: input.userId, idempotencyKey: input.idempotencyKey, inputText: input.text, imageKeys: input.imageKeys })
      .returning();
  } catch (e) {
    if (isUniqueViolation(e)) return replay((await findRequest(db, input.idempotencyKey))!, elapsed());
    throw e;
  }

  const finish = async (outcome: QuickLogOutcome, extra: Partial<typeof aiLogRequests.$inferInsert> = {}) => {
    const out = { ...outcome, elapsedMs: elapsed() };
    await db
      .update(aiLogRequests)
      .set({ status: out.status === "saved" ? "saved" : "needs_review", outcome: out, elapsedMs: out.elapsedMs, ...extra })
      .where(eq(aiLogRequests.id, request.id));
    return out;
  };

  const sendToReview = async (args: {
    fields: ReturnType<typeof toReviewFields>;
    confidence: number | null;
    problems: string[];
    missing: string[];
    candidates: StockCandidate[];
    aiFailed?: boolean;
    parsed?: unknown;
    raw?: unknown;
    model?: string;
    error?: string;
  }) => {
    const review = await createReview(db, {
      aiRequestId: request.id,
      inputText: input.text,
      imageKeys: input.imageKeys,
      fields: args.fields,
      confidence: args.confidence,
      problems: args.problems,
      missing: args.missing,
      candidates: args.candidates,
    });
    return finish(
      {
        status: "needs_review",
        requestId: request.id,
        reviewId: review.id,
        kind: args.fields.type,
        message: args.problems[0] ?? "Needs your review",
        problems: args.problems,
        aiFailed: args.aiFailed,
        elapsedMs: 0,
      },
      { parsed: args.parsed ?? null, rawResponse: args.raw ?? null, model: args.model ?? null, error: args.error ?? null },
    );
  };

  // ── 1. interpret ──
  const stock = await loadStockCandidates(db);
  const { rows, truncated } = selectPromptStock(stock, input.text);
  let interp, raw, model;
  try {
    const r = await input.interpreter({
      text: input.text,
      images: input.images,
      today: now.toISOString().slice(0, 10),
      stock: rows,
      stockTruncated: truncated,
    });
    interp = r.parsed;
    raw = r.raw;
    model = r.model;
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "The AI request failed";
    return sendToReview({
      fields: { type: "unclear", purchase: null, sale: null },
      confidence: null,
      problems: [`${msg}. Your input is saved — fill in the details to log it, or try again.`],
      missing: ["Transaction details"],
      candidates: [],
      aiFailed: true,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // ── 2. deterministic validation ──
  const ev = evaluate(interp, { stock, today: now, mode: "auto" });
  if (ev.decision !== "auto" || !ev.action) {
    const problems = ev.problems.length ? ev.problems : ["Needs your review"];
    return sendToReview({
      fields: toReviewFields(interp),
      confidence: interp.confidence,
      problems: interp.type === "unclear" && interp.questions.length ? [...interp.questions] : problems,
      missing: ev.missing,
      candidates: ev.candidates,
      parsed: interp,
      raw,
      model,
    });
  }

  // ── 3. safe auto-save via the shared services ──
  try {
    const result = await executeAction(db, ev.action, { idempotencyKey: `ql:${input.idempotencyKey}`, aiRequestId: request.id, userId: input.userId });
    const label = describeAction(ev.action, stock);
    const message =
      result.kind === "purchase"
        ? `Added ${label} to stock`
        : `Sold ${label} — profit ${formatINR((result as { profitPaise: number }).profitPaise)}`;
    return finish(
      { status: "saved", requestId: request.id, kind: result.kind, message, profitPaise: result.kind === "sale" ? result.profitPaise : undefined, elapsedMs: 0 },
      { parsed: interp, rawResponse: raw, model },
    );
  } catch (e) {
    // e.g. the last unit sold a moment ago. Nothing was written; park it for a human.
    const msg = e instanceof AppError ? e.message : "Could not save this transaction";
    return sendToReview({
      fields: toReviewFields(interp),
      confidence: interp.confidence,
      problems: [msg],
      missing: [],
      candidates: ev.candidates,
      parsed: interp,
      raw,
      model,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

function describeAction(a: NonNullable<ReturnType<typeof evaluate>["action"]>, stock: StockCandidate[]): string {
  if (a.kind === "purchase") {
    return `${a.product.name} (size ${a.size})${a.quantity > 1 ? ` ×${a.quantity}` : ""} @ ${formatINR(a.unitCostPaise)}`;
  }
  const item = stock.find((s) => s.variantId === a.variantId);
  return `${item?.name ?? "item"} (size ${item?.size ?? "?"})${a.quantity > 1 ? ` ×${a.quantity}` : ""} for ${formatINR(a.unitPricePaise)}`;
}

function replay(row: typeof aiLogRequests.$inferSelect, elapsedMs: number): QuickLogOutcome {
  const stored = row.outcome as QuickLogOutcome | null;
  if (row.status === "pending" || !stored) {
    return { status: "duplicate_in_progress", requestId: row.id, message: "This request is still being processed", elapsedMs, duplicate: true };
  }
  return { ...stored, duplicate: true, elapsedMs };
}

