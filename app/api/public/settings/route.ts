import { publicApi } from "@/lib/api";
import { getSettings } from "@/lib/services/settings";

/** Only the contact details meant for customers. */
export const GET = publicApi(async ({ db }) => {
  const s = await getSettings(db);
  return {
    businessName: s.businessName,
    whatsappNumber: s.whatsappNumber || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "",
    phone: s.phone,
  };
});
