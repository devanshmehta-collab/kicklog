import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { SESSION_COOKIE, assertRole, sessionFromToken, timingSafeEqual, type AuthSession, type Role, type SessionUser } from "./auth";
import { getDb, type DB } from "./db";
import { AppError, forbidden } from "./errors";
import { rateLimit } from "./rate-limit";

export interface ApiCtx<B> {
  req: Request;
  db: DB;
  session: AuthSession;
  user: SessionUser;
  body: B;
  params: Record<string, string>;
  query: URLSearchParams;
  ip: string;
}

export interface PublicCtx<B> extends Omit<ApiCtx<B>, "session" | "user"> {
  session: AuthSession | null;
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && new URL(origin).host !== host) throw forbidden("Cross-origin request blocked");
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    return NextResponse.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "validation_error", message: e.issues[0] ? `${e.issues[0].path.join(".") || "input"}: ${e.issues[0].message}` : "Invalid input", details: e.issues } },
      { status: 400 },
    );
  }
  console.error("[api] unexpected error", e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

interface Options<S extends z.ZodType | undefined> {
  roles: Role[];
  /** Zod schema for the JSON body (POST/PUT/PATCH/DELETE). Omit for GET or multipart handlers. */
  body?: S;
  /** [limit, windowMs] per user for this route. */
  rate?: [number, number];
}

type RouteCtx = { params: Promise<Record<string, string>> };
type Out<S extends z.ZodType | undefined> = S extends z.ZodType ? z.infer<S> : undefined;

/** Authenticated, role-checked, CSRF-protected, rate-limited, validated route handler. */
export function api<S extends z.ZodType | undefined = undefined>(opts: Options<S>, fn: (ctx: ApiCtx<Out<S>>) => Promise<unknown>) {
  return async (req: Request, rc?: RouteCtx): Promise<Response> => {
    try {
      const db = await getDb();
      const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
      const session = assertRole(await sessionFromToken(db, token), opts.roles);
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating) {
        checkOrigin(req);
        const sent = req.headers.get("x-csrf-token") ?? "";
        if (!sent || !timingSafeEqual(sent, session.csrfToken)) throw forbidden("Missing or invalid CSRF token");
      }
      const ip = clientIp(req);
      const [limit, win] = opts.rate ?? [mutating ? 120 : 600, 60_000];
      rateLimit(`api:${session.user.id}:${new URL(req.url).pathname}:${mutating ? "w" : "r"}`, limit, win);

      let body: unknown;
      if (opts.body) {
        let json: unknown;
        try {
          json = await req.json();
        } catch {
          throw new AppError(400, "bad_json", "Request body must be valid JSON");
        }
        body = opts.body.parse(json);
      }
      const result = await fn({
        req,
        db,
        session,
        user: session.user,
        body: body as Out<S>,
        params: rc ? await rc.params : {},
        query: new URL(req.url).searchParams,
        ip,
      });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Public (unauthenticated) JSON endpoint — read-only, rate-limited by IP. */
export function publicApi(fn: (ctx: PublicCtx<undefined>) => Promise<unknown>, rate: [number, number] = [120, 60_000]) {
  return async (req: Request, rc?: RouteCtx): Promise<Response> => {
    try {
      const ip = clientIp(req);
      rateLimit(`pub:${ip}:${new URL(req.url).pathname}`, rate[0], rate[1]);
      const db = await getDb();
      const result = await fn({ req, db, session: null, body: undefined, params: rc ? await rc.params : {}, query: new URL(req.url).searchParams, ip });
      if (result instanceof Response) return result;
      return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=15, stale-while-revalidate=60" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const uuid = z.string().uuid();
export const paiseField = z.number().int().nonnegative().max(1e13);
