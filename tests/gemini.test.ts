import { beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

import { interpretWithGemini } from "@/lib/ai/gemini";

const req = { text: "Bought AJ1 Chicago size 10 for 18k incl shipping", images: [], today: "2026-10-22", stock: [], stockTruncated: false };

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

describe("Gemini Quick Log interpreter", () => {
  it("parses and validates a structured reply", async () => {
    generateContent.mockResolvedValue({
      text: JSON.stringify({ type: "purchase", purchase: { item: "AJ1 Chicago", size: "10", cost_inr: 18000, cost_includes_shipping: true }, confidence: 0.93, questions: [] }),
    });
    const r = await interpretWithGemini(req);
    expect(r.parsed.type).toBe("purchase");
    expect(r.parsed.purchase?.cost_inr).toBe(18000);
    const cfg = generateContent.mock.calls[0][0].config;
    expect(cfg.responseMimeType).toBe("application/json");
    expect(cfg.responseJsonSchema).toBeTruthy();
  });

  it("sends attached images as inline data", async () => {
    generateContent.mockResolvedValue({ text: JSON.stringify({ type: "unclear", confidence: 0.1, questions: ["?"] }) });
    await interpretWithGemini({ ...req, images: [{ mediaType: "image/jpeg", base64: "AAAA" }] });
    const parts = generateContent.mock.calls[0][0].contents[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/jpeg", data: "AAAA" });
  });

  it("rejects replies that are not valid JSON or break the schema", async () => {
    generateContent.mockResolvedValue({ text: "sure! here you go" });
    await expect(interpretWithGemini(req)).rejects.toMatchObject({ code: "ai_invalid" });
    generateContent.mockResolvedValue({ text: JSON.stringify({ type: "refund", confidence: 5 }) });
    await expect(interpretWithGemini(req)).rejects.toMatchObject({ code: "ai_invalid" });
  });

  it("retries a temporary overload, then succeeds", async () => {
    vi.useFakeTimers();
    generateContent
      .mockRejectedValueOnce({ status: 503, message: "high demand" })
      .mockResolvedValueOnce({ text: JSON.stringify({ type: "unclear", confidence: 0.2, questions: [] }) });
    const p = interpretWithGemini(req);
    await vi.advanceTimersByTimeAsync(1500);
    expect((await p).parsed.type).toBe("unclear");
    expect(generateContent).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("fails clearly without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(interpretWithGemini(req)).rejects.toMatchObject({ code: "ai_unconfigured" });
  });
});
