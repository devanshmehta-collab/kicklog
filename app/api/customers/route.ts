import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { CustomerInput, createCustomer, listCustomers } from "@/lib/services/customers";

export const GET = api({ roles: READ }, async ({ db, query }) => listCustomers(db, query.get("q") ?? undefined));
export const POST = api({ roles: WRITE, body: CustomerInput }, async ({ db, body, user }) => createCustomer(db, body, user.id));
