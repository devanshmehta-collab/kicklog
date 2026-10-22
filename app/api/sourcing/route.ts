import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { SourcingInput, createRequest, listRequests } from "@/lib/services/sourcing";

export const GET = api({ roles: READ }, async ({ db }) => listRequests(db));
export const POST = api({ roles: WRITE, body: SourcingInput }, async ({ db, body, user }) => createRequest(db, body, user.id));
