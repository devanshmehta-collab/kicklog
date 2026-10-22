import { publicApi } from "@/lib/api";
import { getPublicProduct } from "@/lib/services/catalog";

export const GET = publicApi(async ({ db, params }) => getPublicProduct(db, params.id));
