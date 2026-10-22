import { z } from "zod";
import { api } from "@/lib/api";
import { badRequest } from "@/lib/errors";
import { OWNER, createUser } from "@/lib/auth";
import { users } from "@/lib/db/schema";

export const GET = api({ roles: OWNER }, async ({ db }) =>
  db.select({ id: users.id, email: users.email, name: users.name, role: users.role, partnerId: users.partnerId, createdAt: users.createdAt }).from(users),
);

export const POST = api(
  { roles: OWNER, body: z.object({ email: z.string().email(), name: z.string().min(1).max(80), password: z.string().min(10), role: z.enum(["owner", "admin", "partner", "viewer"]), partnerId: z.string().uuid().nullish() }) },
  async ({ db, body, user }) => {
    if (body.role === "partner" && !body.partnerId) throw badRequest("Partner users must be linked to a partner");
    const u = await createUser(db, body, user.id);
    return { id: u.id, email: u.email, role: u.role };
  },
);
