import { publicApi } from "@/lib/api";
import { facets, listPublicProducts, type CatalogFilter } from "@/lib/services/catalog";

const num = (v: string | null) => (v && !Number.isNaN(Number(v)) ? Math.round(Number(v) * 100) : undefined);

export const GET = publicApi(async ({ db, query }) => {
  const sort = query.get("sort");
  const all = await listPublicProducts(db);
  const filter: CatalogFilter = {
    q: query.get("q")?.slice(0, 80) || undefined,
    brand: query.get("brand") || undefined,
    category: query.get("category") || undefined,
    condition: query.get("condition") || undefined,
    size: query.get("size") || undefined,
    minPricePaise: num(query.get("min")),
    maxPricePaise: num(query.get("max")),
    sort: sort === "price_asc" || sort === "price_desc" || sort === "name" ? sort : "latest",
  };
  const items = await listPublicProducts(db, filter);
  return { items, facets: facets(all) };
});
