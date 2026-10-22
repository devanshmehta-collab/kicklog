import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionFromToken, userCount } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ensureEnvOwner } from "@/lib/services/bootstrap";

export async function GET(req: Request) {
  try {
    const db = await getDb();
    await ensureEnvOwner(db);
    const m = new RegExp(`(?:^|;\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
    const s = await sessionFromToken(db, m ? decodeURIComponent(m[1]) : null);
    if (!s) return NextResponse.json({ user: null, needsSetup: (await userCount(db)) === 0 }, { status: 401 });
    return NextResponse.json({ user: s.user, csrfToken: s.csrfToken });
  } catch (e) {
    return errorResponse(e);
  }
}
