import { z } from "zod";
import { api } from "@/lib/api";
import { OWNER } from "@/lib/auth";
import { paise } from "@/lib/schemas";
import { addDistribution } from "@/lib/services/partners";

/** Recording a real cash payout is Owner-only. */
export const POST = api({ roles: OWNER, body: z.object({ amountPaise: paise, note: z.string().max(300).nullish() }) }, async ({ db, params, body, user }) =>
  addDistribution(db, params.id, body.amountPaise, body.note, user.id),
);
