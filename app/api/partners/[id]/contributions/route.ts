import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { paise } from "@/lib/schemas";
import { addContribution } from "@/lib/services/partners";

export const POST = api({ roles: WRITE, body: z.object({ amountPaise: paise, note: z.string().max(300).nullish() }) }, async ({ db, params, body, user }) =>
  addContribution(db, params.id, body.amountPaise, body.note, user.id),
);
