import { api } from "@/lib/api";
import { OWNER, READ } from "@/lib/auth";
import { audit } from "@/lib/services/audit";
import { SettingsSchema, getSettings, saveSettings } from "@/lib/services/settings";

export const GET = api({ roles: READ }, async ({ db }) => getSettings(db));
export const PUT = api({ roles: OWNER, body: SettingsSchema.partial() }, async ({ db, body, user }) => {
  const s = await saveSettings(db, body);
  await audit(db, { userId: user.id, action: "settings.update", detail: body });
  return s;
});
