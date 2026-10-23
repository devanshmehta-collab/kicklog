import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { getInvoice } from "@/lib/services/invoice";

/** Customer-safe invoice data (no costs, fees or profit). */
export const GET = api({ roles: READ }, async ({ db, params }) => getInvoice(db, params.id));
