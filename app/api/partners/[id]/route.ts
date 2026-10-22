import { api } from "@/lib/api";
import { ANY } from "@/lib/auth";
import { forbidden } from "@/lib/errors";
import { partnerDetail } from "@/lib/services/partners";

export const GET = api({ roles: ANY }, async ({ db, params, user }) => {
  if (user.role === "partner" && user.partnerId !== params.id) throw forbidden("You can only view your own partner record");
  return partnerDetail(db, params.id);
});
