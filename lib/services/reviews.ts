import { desc, eq } from "drizzle-orm";
import type { DB } from "../db";
import { reviewQueue } from "../db/schema";
import { AppError, conflict, notFound } from "../errors";
import { ReviewFieldsSchema, type ReviewFields } from "../ai/schema";
import { evaluate, type Evaluation, type StockCandidate } from "../rules";
import { audit } from "./audit";
import { executeAction, loadStockCandidates, type ExecResult } from "./execute";

export interface NewReview {
  aiRequestId?: string | null;
  inputText: string;
  imageKeys: string[];
  fields: ReviewFields;
  confidence: number | null;
  problems: string[];
  missing: string[];
  candidates: StockCandidate[];
}

export async function createReview(db: DB, r: NewReview) {
  const [row] = await db
    .insert(reviewQueue)
    .values({
      aiRequestId: r.aiRequestId ?? null,
      inputText: r.inputText,
      imageKeys: r.imageKeys,
      interpretedType: r.fields.type,
      extracted: r.fields as unknown as Record<string, unknown>,
      missing: r.missing,
      problems: r.problems,
      confidence: r.confidence == null ? null : r.confidence.toFixed(3),
      candidates: r.candidates,
    })
    .returning();
  return row;
}

export async function listReviews(db: DB, status: "open" | "resolved" | "discarded" = "open") {
  return db.select().from(reviewQueue).where(eq(reviewQueue.status, status)).orderBy(desc(reviewQueue.createdAt)).limit(100);
}

export async function getReview(db: DB, id: string) {
  const [row] = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id));
  if (!row) throw notFound("Review not found");
  return row;
}

/** Save edits without executing, re-running validation so the card shows what is still missing. */
export async function updateReview(db: DB, id: string, fields: ReviewFields) {
  const rev = await getReview(db, id);
  if (rev.status !== "open") throw conflict("This review is already resolved");
  const ev = evaluate({ ...fields }, { stock: await loadStockCandidates(db), today: new Date(), mode: "confirm" });
  const [row] = await db
    .update(reviewQueue)
    .set({ extracted: fields as unknown as Record<string, unknown>, interpretedType: fields.type, problems: ev.problems, missing: ev.missing, candidates: ev.candidates })
    .where(eq(reviewQueue.id, id))
    .returning();
  return { review: row, evaluation: summarize(ev) };
}

function summarize(ev: Evaluation) {
  return { ok: ev.decision === "auto", problems: ev.problems, missing: ev.missing };
}

/**
 * Confirm: the edited fields are re-validated by the backend (stock, quantities, amounts) and only
 * then turned into a real transaction through the shared services.
 */
export async function confirmReview(
  db: DB,
  id: string,
  opts: { fields?: unknown; userId: string },
): Promise<{ review: typeof reviewQueue.$inferSelect; result: ExecResult }> {
  const rev = await getReview(db, id);
  if (rev.status === "discarded") throw conflict("This review was discarded");
  if (rev.status === "resolved") throw conflict("This review was already confirmed", { resultRef: rev.resultRef });
  const fields = opts.fields ? ReviewFieldsSchema.parse(opts.fields) : ReviewFieldsSchema.parse(rev.extracted);

  const ev = evaluate({ ...fields }, { stock: await loadStockCandidates(db), today: new Date(), mode: "confirm" });
  if (ev.decision !== "auto" || !ev.action) {
    await db
      .update(reviewQueue)
      .set({ extracted: fields as unknown as Record<string, unknown>, interpretedType: fields.type, problems: ev.problems, missing: ev.missing, candidates: ev.candidates })
      .where(eq(reviewQueue.id, id));
    throw new AppError(422, "validation_failed", ev.problems[0] ?? "This transaction can't be saved yet", { problems: ev.problems, missing: ev.missing });
  }
  // Same key every time → double clicks / retries return the original transaction.
  const result = await executeAction(db, ev.action!, {
    idempotencyKey: `review:${id}`,
    aiRequestId: rev.aiRequestId,
    reviewId: id,
    userId: opts.userId,
  });
  const [review] = await db
    .update(reviewQueue)
    .set({ status: "resolved", resolvedBy: opts.userId, resolvedAt: new Date(), resultRef: `${result.kind}:${result.id}`, extracted: fields as unknown as Record<string, unknown> })
    .where(eq(reviewQueue.id, id))
    .returning();
  await audit(db, { userId: opts.userId, action: "review.confirm", entity: "review", entityId: id, detail: { result, edited: !!opts.fields } });
  return { review, result };
}

export async function discardReview(db: DB, id: string, userId: string) {
  const rev = await getReview(db, id);
  if (rev.status !== "open") throw conflict("This review is already resolved");
  const [row] = await db
    .update(reviewQueue)
    .set({ status: "discarded", resolvedBy: userId, resolvedAt: new Date() })
    .where(eq(reviewQueue.id, id))
    .returning();
  await audit(db, { userId, action: "review.discard", entity: "review", entityId: id });
  return row;
}
