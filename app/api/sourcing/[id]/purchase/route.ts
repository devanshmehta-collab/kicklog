import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { LotInput } from "@/lib/schemas";
import { recordPurchaseForRequest } from "@/lib/services/sourcing";

const Body = z.object({
  lot: LotInput,
  brand: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(40).nullish(),
  idempotencyKey: z.string().min(8).max(100).default(() => `sourcing:${randomUUID()}`),
});

/** Record the real purchase for a confirmed request. This is what creates owned stock. */
export const POST = api({ roles: WRITE, body: Body }, async ({ db, params, body, user }) => recordPurchaseForRequest(db, params.id, body, user.id));
