import { z } from "zod";
import type { DB } from "../db";
import { DEFAULT_WHATSAPP_NUMBER } from "../config";
import { businessSettings } from "../db/schema";

export const SettingsSchema = z.object({
  businessName: z.string().trim().max(80).default("Kick Log"),
  /** Accepts "+91 98765 43210", "98765-43210" etc. Stored as digits with country code; a bare 10-digit number is treated as Indian (+91). */
  whatsappNumber: z
    .preprocess((v) => {
      if (typeof v === "number") v = String(Math.trunc(v)); // some drivers hand digit-only JSON strings back as numbers
      if (typeof v !== "string") return v;
      const d = v.replace(/\D/g, "").replace(/^00/, "");
      if (!d && v.trim()) return v; // text with no digits: let validation reject it rather than clearing the field
      return d.length === 10 ? `91${d}` : d;
    }, z.string().regex(/^\d{8,15}$/, "Enter the number with country code, e.g. +91 98765 43210").or(z.literal("")))
    .default(DEFAULT_WHATSAPP_NUMBER),
  phone: z.string().trim().max(30).default(""),
  lowStockThreshold: z.number().int().min(0).max(100).default(1),
  slowMovingDays: z.number().int().min(7).max(720).default(60),
});
export type Settings = z.infer<typeof SettingsSchema>;

/**
 * Values are stored wrapped as { v: value }: a bare JSON string like "919059312317" can come back from the database
 * as a number, which used to make the whole read fail and silently reset every setting to its default.
 */
const unwrap = (raw: unknown) => (raw && typeof raw === "object" && !Array.isArray(raw) && "v" in raw ? (raw as { v: unknown }).v : raw);

export async function getSettings(db: DB): Promise<Settings> {
  const rows = await db.select().from(businessSettings);
  const stored = Object.fromEntries(rows.map((r) => [r.key, unwrap(r.value)]));
  // Validate field by field so one bad value can never wipe the others.
  const out: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(SettingsSchema.shape)) {
    const r = (schema as z.ZodType).safeParse(stored[key]);
    out[key] = r.success ? r.data : (schema as z.ZodType).parse(undefined);
  }
  return out as Settings;
}

export async function saveSettings(db: DB, patch: Partial<Settings>): Promise<Settings> {
  const merged = SettingsSchema.parse({ ...(await getSettings(db)), ...patch });
  for (const [key, value] of Object.entries(merged)) {
    await db
      .insert(businessSettings)
      .values({ key, value: { v: value } })
      .onConflictDoUpdate({ target: businessSettings.key, set: { value: { v: value }, updatedAt: new Date() } });
  }
  return merged;
}
