import { z } from "zod";
import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { paise } from "@/lib/schemas";
import { getProductDetail, updateProduct } from "@/lib/services/inventory";
import { badRequest } from "@/lib/errors";

export const GET = api({ roles: READ }, async ({ db, params }) => getProductDetail(db, params.id));

const Patch = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  brand: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(40).optional(),
  model: z.string().trim().max(120).nullish(),
  colorway: z.string().trim().max(120).nullish(),
  sku: z.string().trim().max(60).nullish(),
  condition: z.string().trim().max(40).optional(),
  description: z.string().trim().max(4000).nullish(),
  retailPricePaise: paise.nullish(),
  publicPricePaise: paise.nullish(),
  status: z.enum(["draft", "published", "archived"]).optional(),
});

export const PATCH = api({ roles: WRITE, body: Patch }, async ({ db, params, body, user }) => {
  if (body.status === "published") {
    const { product } = await getProductDetail(db, params.id);
    const price = body.publicPricePaise !== undefined ? body.publicPricePaise : product.publicPricePaise;
    if (price == null) throw badRequest("Set a public price before publishing");
  }
  return updateProduct(db, params.id, body, user.id);
});
