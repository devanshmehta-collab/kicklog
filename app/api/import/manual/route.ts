import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { startManualImport } from "@/lib/services/imports";

/** Start an empty import record for typing a product in by hand (e.g. when a site blocks automated readers). */
export const POST = api({ roles: WRITE }, async ({ db, user }) => ({ importId: await startManualImport(db, null, user.id) }));
