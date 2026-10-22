import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, bootstrapOwner, login } from "@/lib/auth";
import { clientIp, errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const Body = z.object({ email: z.string().email().max(200), name: z.string().trim().min(1).max(80), password: z.string().min(10).max(200) });

/** First-run only: creates the Owner while no users exist. */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    rateLimit(`setup:${ip}`, 5, 15 * 60_000);
    const db = await getDb();
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
      return NextResponse.json({ error: { code: "forbidden", message: "Cross-origin request blocked" } }, { status: 403 });
    }
    const b = Body.parse(await req.json());
    await bootstrapOwner(db, b);
    const r = await login(db, b.email, b.password, ip);
    const res = NextResponse.json({ user: r.user });
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: r.expiresAt });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
