import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { SourcingInput, updateRequest } from "@/lib/services/sourcing";

export const PATCH = api({ roles: WRITE, body: SourcingInput.partial() }, async ({ db, params, body, user }) => updateRequest(db, params.id, body, user.id));
