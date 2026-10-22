import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { extractProduct } from "@/lib/services/imports";

export const maxDuration = 60;

export const POST = api({ roles: WRITE, rate: [10, 60_000], body: z.object({ url: z.string().min(8).max(2000) }) }, async ({ db, body, user }) =>
  extractProduct(db, body.url, user.id),
);
