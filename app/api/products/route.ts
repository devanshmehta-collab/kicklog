import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { LotInput, lotToPurchase, paise } from "@/lib/schemas";
import { addProductImage, createPurchase, updateProduct } from "@/lib/services/inventory";
import { badRequest } from "@/lib/errors";
import { fileUrl } from "@/lib/storage";

export const GET = api({ roles: READ }, async ({ db }) => {
  const res = await db.execute(sql`
    select p.id, p.name, p.brand, p.category, p.model, p.colorway, p.sku, p.condition, p.description, p.status,
      p.public_price_paise::float8 as "publicPricePaise", p.retail_price_paise::float8 as "retailPricePaise", p.created_at as "createdAt",
      coalesce((select sum(l.quantity_remaining) from inventory_lots l join product_variants v on v.id = l.variant_id where v.product_id = p.id), 0)::int as units,
      coalesce((select json_agg(x order by x) from (select distinct v.size as x from product_variants v join inventory_lots l on l.variant_id = v.id where v.product_id = p.id and l.quantity_remaining > 0) s), '[]'::json) as sizes,
      (select url from product_images i where i.product_id = p.id order by is_primary desc, position asc limit 1) as "imageUrl"
    from products p order by p.created_at desc limit 500`);
  return res.rows;
});

const Create = z.object({
  requestId: z.string().min(8).max(100).default(() => randomUUID()),
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().max(80).nullish(),
  category: z.string().trim().max(40).default("sneakers"),
  model: z.string().trim().max(120).nullish(),
  colorway: z.string().trim().max(120).nullish(),
  sku: z.string().trim().max(60).nullish(),
  condition: z.string().trim().max(40).default("new"),
  description: z.string().trim().max(4000).nullish(),
  retailPricePaise: paise.nullish(),
  publicPricePaise: paise.nullish(),
  status: z.enum(["draft", "published"]).default("draft"),
  lots: z.array(LotInput).min(1).max(30),
  imageKeys: z.array(z.string().regex(/^p-[a-f0-9]{32}\.(jpg|png|webp|gif)$/)).max(12).default([]),
});

/** Manual "Add product": product + one acquisition lot per size, all through the shared purchase service. */
export const POST = api({ roles: WRITE, body: Create }, async ({ db, body, user }) => {
  if (body.status === "published" && body.publicPricePaise == null) throw badRequest("Set a public price before publishing");
  const fields = {
    name: body.name,
    brand: body.brand,
    category: body.category,
    model: body.model,
    colorway: body.colorway,
    sku: body.sku,
    condition: body.condition,
    description: body.description,
    retailPricePaise: body.retailPricePaise,
    publicPricePaise: body.publicPricePaise,
  };
  let productId = "";
  for (const [i, lot] of body.lots.entries()) {
    const r = await createPurchase(db, lotToPurchase(lot, fields, `manual:${body.requestId}:${i}`, user.id));
    productId = r.productId;
  }
  await updateProduct(db, productId, { ...fields, status: body.status }, user.id);
  for (const [i, key] of body.imageKeys.entries()) await addProductImage(db, productId, fileUrl(key), i === 0);
  return { productId };
});
