import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { ImportSaveSchema, saveImport } from "@/lib/services/imports";

export const POST = api({ roles: WRITE, body: ImportSaveSchema }, async ({ db, params, body }) => saveImport(db, params.id, body));
