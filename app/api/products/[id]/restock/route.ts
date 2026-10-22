import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { LotInput, lotToPurchase } from "@/lib/schemas";
import { createPurchase, getProductDetail } from "@/lib/services/inventory";

const Body = z.object({ requestId: z.string().min(8).max(100).default(() => randomUUID()), lot: LotInput });

/** Restock an existing product: a new acquisition lot with its own cost. */
export const POST = api({ roles: WRITE, body: Body }, async ({ db, params, body, user }) => {
  const { product } = await getProductDetail(db, params.id);
  return createPurchase(db, lotToPurchase(body.lot, { name: product.name, brand: product.brand, category: product.category, condition: product.condition }, `restock:${body.requestId}`, user.id));
});
