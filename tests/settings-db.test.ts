import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db";
import { businessSettings } from "@/lib/db/schema";
import { getSettings, saveSettings } from "@/lib/services/settings";
import { testDb } from "./helpers";

let db: DB, close: () => Promise<void>;
beforeAll(async () => ({ db, close } = await testDb()));
afterAll(() => close());

describe("settings persistence", () => {
  it("defaults to the owner's WhatsApp number until one is saved", async () => {
    const t = await testDb();
    expect((await getSettings(t.db)).whatsappNumber).toBe("919059312317");
    await t.close();
  });

  it("what you save is what you read back", async () => {
    await saveSettings(db, { whatsappNumber: "+91 9059312317", phone: "+91 90593 12317", businessName: "My Store", lowStockThreshold: 3, slowMovingDays: 45 });
    const rows = await db.select().from(businessSettings);
    console.log("stored rows:", JSON.stringify(rows.map((r) => [r.key, r.value, typeof r.value])));
    expect(await getSettings(db)).toMatchObject({ whatsappNumber: "919059312317", businessName: "My Store", lowStockThreshold: 3, slowMovingDays: 45 });
  });
  it("saving one field keeps the others", async () => {
    await saveSettings(db, { phone: "12345678" });
    expect((await getSettings(db)).whatsappNumber).toBe("919059312317");
  });

  it("still reads rows written the old way (a bare number) and ignores one bad value without resetting the rest", async () => {
    const t = await testDb();
    await t.db.insert(businessSettings).values([
      { key: "whatsappNumber", value: 919012345678 }, // legacy: digits came back as a number
      { key: "businessName", value: "Old Store" },
      { key: "lowStockThreshold", value: "not a number" }, // corrupt
    ]);
    const s = await getSettings(t.db);
    expect(s.whatsappNumber).toBe("919012345678");
    expect(s.businessName).toBe("Old Store");
    expect(s.lowStockThreshold).toBe(1); // falls back alone
    await t.close();
  });

  it("an owner can clear the number and it stays cleared", async () => {
    const t = await testDb();
    await saveSettings(t.db, { whatsappNumber: "" });
    expect((await getSettings(t.db)).whatsappNumber).toBe("");
    await t.close();
  });
});