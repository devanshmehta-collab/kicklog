import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { summary } from "@/lib/services/analytics";

export const GET = api({ roles: READ }, async ({ db, query }) => {
  const from = query.get("from");
  const to = query.get("to");
  return summary(db, { from: from ? new Date(from) : undefined, to: to ? new Date(`${to}T23:59:59.999Z`) : undefined });
});
