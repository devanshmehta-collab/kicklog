import { SESSION_COOKIE, sessionFromToken } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { getDb } from "@/lib/db";
import { readImage } from "@/lib/storage";

/** Product images (p-*) are public. Bills and receipts (b-*) require a signed-in session. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const { key } = await params;
    if (key.startsWith("b-")) {
      const m = new RegExp(`(?:^|;\s*)${SESSION_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
      const s = await sessionFromToken(await getDb(), m ? decodeURIComponent(m[1]) : null);
      if (!s || s.user.role === "partner") return new Response("Not found", { status: 404 });
    }
    const file = await readImage(key);
    if (!file) return new Response("Not found", { status: 404 });
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": key.startsWith("p-") ? "public, max-age=86400, immutable" : "private, max-age=3600",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
