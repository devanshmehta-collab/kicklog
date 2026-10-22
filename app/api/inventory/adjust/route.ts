import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { adjustStock } from "@/lib/services/inventory";

export const POST = api(
  { roles: WRITE, body: z.object({ lotId: z.string().uuid(), delta: z.number().int().min(-10000).max(10000), reason: z.string().trim().min(2).max(200) }) },
  async ({ db, body, user }) => adjustStock(db, { ...body, userId: user.id }),
);
