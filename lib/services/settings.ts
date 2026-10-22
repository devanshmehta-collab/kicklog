import { z } from "zod";
import type { DB } from "../db";
import { businessSettings } from "../db/schema";

export const SettingsSchema = z.object({
  businessName: z.string().trim().max(80).default("Kick Log"),
  /** Accepts "+91 98765 43210", "98765-43210" etc. Stored as digits with country code; a bare 10-digit number is treated as Indian (+91). */
  whatsappNumber: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const d = v.replace(/\D/g, "").replace(/^00/, "");
      if (!d && v.trim()) return v; // text with no digits: let validation reject it rather than clearing the field
      return d.length === 10 ? `91${d}` : d;
    }, z.string().regex(/^\d{8,15}$/, "Enter the number with country code, e.g. +91 98765 43210").or(z.literal("")))
    .default(""),
  phone: z.string().trim().max(30).default(""),
  lowStockThreshold: z.number().int().min(0).max(100).default(1),
  slowMovingDays: z.number().int().min(7).max(720).default(60),
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
