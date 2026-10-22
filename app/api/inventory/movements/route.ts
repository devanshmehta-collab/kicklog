import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { listMovements } from "@/lib/services/inventory";

export const GET = api({ roles: READ }, async ({ db }) => listMovements(db, 200));
