import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { ReviewFieldsSchema } from "@/lib/ai/schema";
import { getReview, updateReview } from "@/lib/services/reviews";

export const GET = api({ roles: READ }, async ({ db, params }) => getReview(db, params.id));

/** Save edits (re-validated, nothing is executed). */
export const PATCH = api({ roles: WRITE, body: ReviewFieldsSchema }, async ({ db, params, body }) => updateReview(db, params.id, body));
