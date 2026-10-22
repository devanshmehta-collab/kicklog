import { GoogleGenAI } from "@google/genai";
import { AppError } from "../errors";
import type { Interpreter } from "./client";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { InterpretationSchema, interpretationJsonSchema } from "./schema";

/**
 * Quick Log interpreter backed by Gemini (free tier available). Same contract as the Claude one:
 * the model only returns a structured guess, which is validated with Zod and then by lib/rules.ts.
 */
export const interpretWithGemini: Interpreter = async (req) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AppError(503, "ai_unconfigured", "GEMINI_API_KEY is not configured on the server");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const ai = new GoogleGenAI({ apiKey: key });

  const parts = [
    ...req.images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.base64 } })),
    { text: buildUserPrompt({ text: req.text, today: req.today, stock: req.stock, stockTruncated: req.stockTruncated, imageCount: req.images.length }) },
  ];

  let text = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: `${SYSTEM_PROMPT}\n\nReply with ONLY a JSON object matching the schema.`,
          responseMimeType: "application/json",
          responseJsonSchema: interpretationJsonSchema(),
        },
      });
      text = (res.text ?? "").trim();
      break;
    } catch (e) {
      const err = e as { status?: number | string; message?: string };
      const busy = err.status === 503 || err.status === 429 || /"code":\s*(503|429)|UNAVAILABLE|high demand/i.test(err.message ?? "");
      if (!busy) throw new AppError(502, "ai_error", `Gemini request failed: ${(err.message ?? "unknown error").slice(0, 200)}`);
      if (attempt === 2) throw new AppError(503, "ai_busy", "Google's AI is overloaded right now");
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
  } catch {
    throw new AppError(502, "ai_invalid", "The model did not return valid JSON");
  }
  const parsed = InterpretationSchema.safeParse(raw);
  if (!parsed.success) throw new AppError(502, "ai_invalid", "The model returned an invalid structure", parsed.error.issues.slice(0, 5));
  return { parsed: parsed.data, raw, model };
};
