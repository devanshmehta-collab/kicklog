import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { linkSale } from "@/lib/services/sourcing";

export const POST = api({ roles: WRITE, body: z.object({ saleId: z.string().uuid() }) }, async ({ db, params, body, user }) => linkSale(db, params.id, body.saleId, user.id));
