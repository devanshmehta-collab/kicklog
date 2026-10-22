import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import type { DB } from "./db";
import { sessions, users } from "./db/schema";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import { rateLimit } from "./rate-limit";
import { audit } from "./services/audit";

export type Role = "owner" | "admin" | "partner" | "viewer";
export const SESSION_COOKIE = "kl_session";
const SESSION_DAYS = 14;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  partnerId: string | null;
}

export interface AuthSession {
  user: SessionUser;
  csrfToken: string;
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, process.env.NODE_ENV === "test" ? 4 : 11);
const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function validatePassword(pw: string) {
  if (pw.length < 10) throw badRequest("Password must be at least 10 characters");
  if (!/[a-z]/i.test(pw) || !/\d/.test(pw)) throw badRequest("Password needs letters and at least one number");
}

export async function userCount(db: DB) {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return r.n;
}

/** First-run: create the Owner. Only allowed while the users table is empty. */
export async function bootstrapOwner(db: DB, input: { email: string; name: string; password: string }) {
  validatePassword(input.password);
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`lock table users in share row exclusive mode`);
    if ((await userCount(tx)) > 0) throw forbidden("Setup is already complete");
    const [u] = await tx
      .insert(users)
      .values({ email: input.email.toLowerCase().trim(), name: input.name.trim(), passwordHash, role: "owner" })
      .returning();
    await audit(tx, { userId: u.id, action: "auth.bootstrap_owner", entity: "user", entityId: u.id });
    return u;
  });
}

export async function createUser(db: DB, input: { email: string; name: string; password: string; role: Role; partnerId?: string | null }, actorId?: string) {
  validatePassword(input.password);
  const [u] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase().trim(),
      name: input.name.trim(),
      passwordHash: await hashPassword(input.password),
      role: input.role,
      partnerId: input.partnerId ?? null,
    })
    .returning();
  await audit(db, { userId: actorId, action: "user.create", entity: "user", entityId: u.id, detail: { role: input.role } });
  return u;
}

const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 4);

export async function login(db: DB, email: string, password: string, ip: string) {
  const e = email.toLowerCase().trim();
  rateLimit(`login:ip:${ip}`, 20, 15 * 60_000);
  rateLimit(`login:acct:${e}`, 8, 15 * 60_000);
  const [u] = await db.select().from(users).where(eq(users.email, e));
  const ok = await bcrypt.compare(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) {
    await audit(db, { action: "auth.login_failed", detail: { email: e }, ip });
    throw new AppError(401, "invalid_credentials", "Incorrect email or password");
  }
  const token = crypto.randomBytes(32).toString("hex");
  const csrfToken = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(sessions).values({ userId: u.id, tokenHash: sha256(token), csrfToken, expiresAt });
  await audit(db, { userId: u.id, action: "auth.login", ip });
  return { token, expiresAt, user: toSessionUser(u) };
}

const toSessionUser = (u: typeof users.$inferSelect): SessionUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, partnerId: u.partnerId });

export async function sessionFromToken(db: DB, token: string | undefined | null): Promise<AuthSession | null> {
  if (!token) return null;
  const [row] = await db
    .select({ u: users, csrf: sessions.csrfToken })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())));
  return row ? { user: toSessionUser(row.u), csrfToken: row.csrf } : null;
}

export async function destroySession(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export function setSessionCookie(jar: Awaited<ReturnType<typeof cookies>>, token: string, expires: Date) {
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export const READ: Role[] = ["owner", "admin", "viewer"];
export const WRITE: Role[] = ["owner", "admin"];
export const OWNER: Role[] = ["owner"];
export const ANY: Role[] = ["owner", "admin", "viewer", "partner"];

export function assertRole(s: AuthSession | null, roles: Role[]): AuthSession {
  if (!s) throw unauthorized();
  if (!roles.includes(s.user.role)) throw forbidden("Your role cannot do this");
  return s;
}

export function timingSafeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
