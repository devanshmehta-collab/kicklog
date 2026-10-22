import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { ReviewFieldsSchema } from "@/lib/ai/schema";
import { confirmReview } from "@/lib/services/reviews";

export const POST = api({ roles: WRITE, body: z.object({ fields: ReviewFieldsSchema.optional() }) }, async ({ db, params, body, user }) => {
  const { result } = await confirmReview(db, params.id, { fields: body.fields, userId: user.id });
  return { result };
});
