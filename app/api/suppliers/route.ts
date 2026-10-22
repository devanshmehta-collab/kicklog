import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { SupplierInput, createSupplier, listSuppliers } from "@/lib/services/sourcing";

export const GET = api({ roles: READ }, async ({ db }) => listSuppliers(db));
export const POST = api({ roles: WRITE, body: SupplierInput }, async ({ db, body }) => createSupplier(db, body));
