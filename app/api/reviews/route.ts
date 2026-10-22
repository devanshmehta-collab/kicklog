import { api } from "@/lib/api";
import { READ } from "@/lib/auth";
import { listReviews } from "@/lib/services/reviews";

export const GET = api({ roles: READ }, async ({ db, query }) => {
  const status = query.get("status");
  return listReviews(db, status === "resolved" || status === "discarded" ? status : "open");
});
