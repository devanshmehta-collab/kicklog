import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { listStock } from "@/lib/services/inventory";

export const GET = api({ roles: READ }, async ({ db, query }) =>
  listStock(db, {
    q: query.get("q") ?? undefined,
    category: query.get("category") ?? undefined,
    brand: query.get("brand") ?? undefined,
    status: query.get("status") ?? undefined,
    includeEmpty: query.get("includeEmpty") === "1",
  }),
);
