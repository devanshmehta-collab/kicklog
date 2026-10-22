import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { recentActivity } from "@/lib/services/analytics";

export const GET = api({ roles: READ }, async ({ db }) => recentActivity(db));
