import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { paise } from "@/lib/schemas";
import { refundSaleItem } from "@/lib/services/sales";

const Body = z.object({
  saleItemId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10000),
  restock: z.boolean(),
  amountPaise: paise.optional(),
  reason: z.string().trim().max(300).nullish(),
  idempotencyKey: z.string().min(8).max(100).default(() => `refund:${randomUUID()}`),
});

export const POST = api({ roles: WRITE, body: Body }, async ({ db, body, user }) => refundSaleItem(db, { ...body, userId: user.id }));
