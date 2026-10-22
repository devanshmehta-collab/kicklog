import { describe, expect, it } from "vitest";
import { SettingsSchema } from "@/lib/services/settings";

const parse = (whatsappNumber: unknown) => SettingsSchema.safeParse({ whatsappNumber });

describe("WhatsApp number setting", () => {
  it.each([
    ["+91 98765 43210", "919876543210"],
    ["98765-43210", "919876543210"],
    ["9876543210", "919876543210"],
    ["919876543210", "919876543210"],
    ["00919876543210", "919876543210"],
    ["+1 (415) 555-0132", "14155550132"],
    ["", ""],
  ])("%s → %s", (input, out) => {
    const r = parse(input);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.whatsappNumber).toBe(out);
  });

  it("rejects things that are not phone numbers", () => {
    expect(parse("abc").success).toBe(false);
    expect(parse("12345").success).toBe(false);
  });
});
