import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { discardReview } from "@/lib/services/reviews";

export const POST = api({ roles: WRITE }, async ({ db, params, user }) => discardReview(db, params.id, user.id));
