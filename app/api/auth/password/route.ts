import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { api } from "@/lib/api";
import { ANY, hashPassword, validatePassword } from "@/lib/auth";
import { sessions, users } from "@/lib/db/schema";
import { badRequest } from "@/lib/errors";
import { audit } from "@/lib/services/audit";

/** Change your own password. All of your other sessions are signed out. */
export const POST = api(
  { roles: ANY, rate: [5, 15 * 60_000], body: z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) }) },
  async ({ db, body, user, session }) => {
    const [u] = await db.select().from(users).where(eq(users.id, user.id));
    if (!(await bcrypt.compare(body.current, u.passwordHash))) throw badRequest("Current password is incorrect");
    validatePassword(body.next);
    await db.update(users).set({ passwordHash: await hashPassword(body.next) }).where(eq(users.id, user.id));
    // keep this browser signed in (matched by csrf token), drop the rest
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.csrfToken, session.csrfToken)));
    await audit(db, { userId: user.id, action: "auth.password_change" });
    return { ok: true };
  },
);
