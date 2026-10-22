import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, login } from "@/lib/auth";
import { clientIp, errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ensureEnvOwner } from "@/lib/services/bootstrap";

const Body = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export async function POST(req: Request) {
  try {
    const db = await getDb();
    await ensureEnvOwner(db);
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))) {
      return NextResponse.json({ error: { code: "forbidden", message: "Cross-origin request blocked" } }, { status: 403 });
    }
    const { email, password } = Body.parse(await req.json());
    const r = await login(db, email, password, clientIp(req));
    const res = NextResponse.json({ user: r.user });
    res.cookies.set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: r.expiresAt });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
