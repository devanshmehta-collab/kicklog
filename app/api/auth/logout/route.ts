import { NextResponse } from "next/server";
import { SESSION_COOKIE, destroySession } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const m = /(?:^|;\s*)kl_session=([^;]+)/.exec(req.headers.get("cookie") ?? "");
    if (m) await destroySession(await getDb(), decodeURIComponent(m[1]));
    const res = NextResponse.json({ ok: true });
    res.cookies.delete(SESSION_COOKIE);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
