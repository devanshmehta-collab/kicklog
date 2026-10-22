import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { notFound } from "../errors";

/**
 * PUBLIC catalogue. This is the only place the customer-facing site reads inventory from, and it
 * selects an explicit allow-list of columns — acquisition cost, profit, partners and buyers are never touched.
 */
export interface PublicProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  condition: string;
  colorway: string | null;
  sku: string | null;
  description: string | null;
  pricePaise: number;
  images: string[];
  sizes: string[];
  createdAt: string;
}

export interface CatalogFilter {
  q?: string;
  brand?: string;
  category?: string;
  condition?: string;
  size?: string;
  minPricePaise?: number;
  maxPricePaise?: number;
  sort?: "latest" | "price_asc" | "price_desc" | "name";
}

const BASE = sql`
  select p.id, p.name, p.brand, p.category, p.condition, p.colorway, p.sku, p.description,
    p.public_price_paise::float8 as price, p.created_at as "createdAt",
    (select coalesce(json_agg(url order by is_primary desc, position asc), '[]'::json) from product_images i where i.product_id = p.id) as images,
    (select coalesce(json_agg(size order by size), '[]'::json) from (
        select v.size from product_variants v join inventory_lots l on l.variant_id = v.id
        where v.product_id = p.id group by v.size having sum(l.quantity_remaining) > 0) s) as sizes
  from products p
  where p.status = 'published' and p.public_price_paise is not null
    and exists (select 1 from product_variants v join inventory_lots l on l.variant_id = v.id where v.product_id = p.id and l.quantity_remaining > 0)
`;

function map(r: Record<string, unknown>): PublicProduct {
  return {
    id: String(r.id),
    name: String(r.name),
    brand: (r.brand as string) ?? null,
    category: String(r.category),
    condition: String(r.condition),
    colorway: (r.colorway as string) ?? null,
    sku: (r.sku as string) ?? null,
    description: (r.description as string) ?? null,
    pricePaise: Number(r.price),
    images: (r.images as string[]) ?? [],
    sizes: (r.sizes as string[]) ?? [],
    createdAt: new Date(r.createdAt as string).toISOString(),
  };
}

export async function listPublicProducts(db: DB, f: CatalogFilter = {}): Promise<PublicProduct[]> {
  const res = (await db.execute(BASE)).rows as Record<string, unknown>[];
  let items = res.map(map);
  if (f.q) {
    const q = f.q.toLowerCase();
    items = items.filter((p) => [p.name, p.sku, p.brand, p.colorway].some((x) => x?.toLowerCase().includes(q)));
  }
  if (f.brand) items = items.filter((p) => p.brand === f.brand);
  if (f.category) items = items.filter((p) => p.category === f.category);
  if (f.condition) items = items.filter((p) => p.condition === f.condition);
  if (f.size) items = items.filter((p) => p.sizes.includes(f.size!));
  if (f.minPricePaise != null) items = items.filter((p) => p.pricePaise >= f.minPricePaise!);
  if (f.maxPricePaise != null) items = items.filter((p) => p.pricePaise <= f.maxPricePaise!);
  const sort = f.sort ?? "latest";
  items.sort((a, b) =>
    sort === "price_asc" ? a.pricePaise - b.pricePaise
    : sort === "price_desc" ? b.pricePaise - a.pricePaise
    : sort === "name" ? a.name.localeCompare(b.name)
    : b.createdAt.localeCompare(a.createdAt),
  );
  return items;
}

export async function getPublicProduct(db: DB, id: string): Promise<PublicProduct> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound("Product not found");
  const res = (await db.execute(sql`${BASE} and p.id = ${id}`)).rows as Record<string, unknown>[];
  if (!res[0]) throw notFound("Product not found");
  return map(res[0]);
}

export function facets(items: PublicProduct[]) {
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  return {
    brands: uniq(items.map((i) => i.brand)),
    categories: uniq(items.map((i) => i.category)),
    conditions: uniq(items.map((i) => i.condition)),
    sizes: uniq(items.flatMap((i) => i.sizes)).sort((a, b) => parseFloat(a) - parseFloat(b) || a.localeCompare(b)),
  };
}

export function whatsappLink(number: string, p: Pick<PublicProduct, "name" | "sku" | "pricePaise">, size?: string | null, origin = "") {
  const price = new Intl.NumberFormat("en-IN").format(p.pricePaise / 100);
  const text = `Hi! I'm interested in ${p.name}${size ? ` (size ${size})` : ""} — ₹${price}${p.sku ? ` — SKU ${p.sku}` : ""}${origin ? `\n${origin}` : ""}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
