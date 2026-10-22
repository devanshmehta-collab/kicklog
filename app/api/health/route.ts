import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { blobAuth, storageDriver, storageProblem } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Strip anything that looks like a connection string, host or credential before it leaves the server. */
const redact = (s: string) =>
  s
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi, "<url>")
    .replace(/\b[\w.-]+\.(?:neon\.tech|supabase\.co|supabase\.com|amazonaws\.com|vercel-storage\.com)\b/gi, "<host>")
    .slice(0, 400);

/**
 * Health check for deployments: GET /api/health.
 * Reports which required settings are present (never their values) and whether the database answers.
 */
export async function GET() {
  const env = {
    DATABASE_URL: !!process.env.DATABASE_URL?.trim(),
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    storage: storageDriver(),
    blobAuth: ((a) => (a ? ("token" in a ? "token" : "vercel-identity+store-id") : null))(blobAuth()),
    // names only (never values) of variables that look storage-related, to spot a mis-named or missing one
    storageVariables: Object.keys(process.env).filter((k) => /blob|s3_|storage/i.test(k)).sort(),
    storageProblem: storageProblem(),
    onVercel: !!process.env.VERCEL,
  };
  try {
    const db = await getDb();
    const r = await db.execute(sql`select count(*)::int as tables from information_schema.tables where table_schema = 'public'`);
    return NextResponse.json({ ok: true, env, database: "connected", tables: (r.rows[0] as { tables: number }).tables });
  } catch (e) {
    const err = e as { message?: string; code?: string; cause?: { message?: string; code?: string } };
    return NextResponse.json(
      {
        ok: false,
        env,
        database: "failed",
        code: err.cause?.code ?? err.code ?? null,
        error: redact(err.cause?.message ?? err.message ?? String(e)),
        query: err.message && /^Failed query:/.test(err.message) ? redact(err.message.split("\n")[0]) : undefined,
      },
      { status: 503 },
    );
  }
}
