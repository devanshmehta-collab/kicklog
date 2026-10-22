import { api } from "@/lib/api";
import { ANY, WRITE } from "@/lib/auth";
import { forbidden } from "@/lib/errors";
import { PartnerInput, createPartner, partnerDetail, partnerLedger } from "@/lib/services/partners";

/** Staff see the consolidated ledger. A Partner login sees only their own record. */
export const GET = api({ roles: ANY }, async ({ db, user }) => {
  if (user.role === "partner") {
    if (!user.partnerId) throw forbidden("Your login is not linked to a partner");
    return { mine: await partnerDetail(db, user.partnerId) };
  }
  return { ledger: await partnerLedger(db) };
});

export const POST = api({ roles: WRITE, body: PartnerInput }, async ({ db, body, user }) => createPartner(db, body, user.id));
