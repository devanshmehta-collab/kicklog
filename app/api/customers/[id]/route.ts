import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { CustomerInput, updateCustomer } from "@/lib/services/customers";

export const PATCH = api({ roles: WRITE, body: CustomerInput.partial() }, async ({ db, params, body, user }) => updateCustomer(db, params.id, body, user.id));
