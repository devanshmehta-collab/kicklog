import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { advance } from "@/lib/services/sourcing";

export const POST = api(
  { roles: WRITE, body: z.object({ status: z.enum(["requested", "sourcing", "quoted", "confirmed", "purchased", "delivered", "completed", "cancelled"]) }) },
  async ({ db, params, body, user }) => advance(db, params.id, body.status, user.id),
);
