import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "../errors";
import { InterpretationSchema, interpretationJsonSchema, type Interpretation } from "./schema";
import { SYSTEM_PROMPT, TOOL_NAME, buildUserPrompt, type PromptStockRow } from "./prompt";

export interface InterpretImage {
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
  base64: string;
}

export interface InterpretRequest {
  text: string;
  images: InterpretImage[];
  today: string;
  stock: PromptStockRow[];
  stockTruncated: boolean;
}

export interface InterpretResult {
  parsed: Interpretation;
  raw: unknown;
  model: string;
}

export type Interpreter = (req: InterpretRequest) => Promise<InterpretResult>;

let client: Anthropic | null = null;

/** Claude is only ever called from the server; the key never reaches the browser. */
export const interpretWithClaude: Interpreter = async (req) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AppError(503, "ai_unconfigured", "ANTHROPIC_API_KEY is not configured on the server");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
  client ??= new Anthropic({ apiKey, timeout: 40_000, maxRetries: 1 });

  const content: Anthropic.Messages.ContentBlockParam[] = [
    ...req.images.map(
      (img) =>
        ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } }) as Anthropic.Messages.ImageBlockParam,
    ),
    {
      type: "text",
      text: buildUserPrompt({ text: req.text, today: req.today, stock: req.stock, stockTruncated: req.stockTruncated, imageCount: req.images.length }),
    },
  ];

  const res = await client.messages.create({
    model,
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Record your interpretation of the user's purchase/sale message.",
        input_schema: interpretationJsonSchema() as Anthropic.Messages.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new AppError(502, "ai_invalid", "The model did not return a structured result");
  const parsed = InterpretationSchema.safeParse(block.input);
  if (!parsed.success) {
    throw new AppError(502, "ai_invalid", "The model returned an invalid structure", parsed.error.issues.slice(0, 5));
  }
  return { parsed: parsed.data, raw: block.input, model };
};
