import { z } from "zod";
import type { DB } from "../db";
import { businessSettings } from "../db/schema";

export const SettingsSchema = z.object({
  businessName: z.string().trim().max(80).default("Kick Log"),
  whatsappNumber: z.string().trim().regex(/^\d{8,15}$/, "Digits only with country code").or(z.literal("")).default(""),
  phone: z.string().trim().max(30).default(""),
  lowStockThreshold: z.number().int().min(0).max(100).default(1),
  slowMovingDays: z.number().int().min(7).max(720).default(60),
  importAllowedHosts: z.array(z.string().trim().toLowerCase()).default(["stockx.com", "goat.com", "nike.com", "farfetch.com"]),
});
export type Settings = z.infer<typeof SettingsSchema>;

export async function getSettings(db: DB): Promise<Settings> {
  const rows = await db.select().from(businessSettings);
  const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const parsed = SettingsSchema.safeParse(obj);
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(db: DB, patch: Partial<Settings>): Promise<Settings> {
  const merged = SettingsSchema.parse({ ...(await getSettings(db)), ...patch });
  for (const [key, value] of Object.entries(merged)) {
    await db
      .insert(businessSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: businessSettings.key, set: { value, updatedAt: new Date() } });
  }
  return merged;
}
