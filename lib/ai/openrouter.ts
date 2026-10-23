import { z } from "zod";
import { AppError } from "../errors";

/**
 * The ONLY place Hyped Stash talks to an AI provider.
 * Everything goes through OpenRouter, to Google models, pinned to Google's own endpoints.
 * Server-side only: the key is read from the environment and never logged or returned.
 */

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_MODEL = "google/gemini-3.7-flash";
/** Sent with EVERY request. No fallbacks to other providers. */
export const PROVIDER_ROUTING = { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false } as const;
const MAX_RETRIES = 3;

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): OpenRouterConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError(503, "ai_unconfigured", "OPENROUTER_API_KEY is not set. Add it to .env.local (server-side only) and restart.");
  }
  const model = (env.OPENROUTER_MODEL?.trim() || DEFAULT_MODEL).replace(/:batch$/, "");
  if (!model.startsWith("google/")) {
    throw new AppError(500, "ai_misconfigured", `OPENROUTER_MODEL must be a google/* model (got "${model.split("/")[0]}/…").`);
  }
  return { apiKey, model, baseUrl: (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "") };
}

export type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export interface Message {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  usage: Usage | null;
  durationMs: number;
  attempts: number;
}

type Sleep = (ms: number) => Promise<void>;
export interface ChatOptions {
  messages: Message[];
  /** JSON Schema for strict structured output. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  timeoutMs?: number;
  /** For tests / logging label only. */
  feature?: string;
  fetchImpl?: typeof fetch;
  sleep?: Sleep;
  config?: OpenRouterConfig;
  /** Set false to skip the structured-output requirement (connection test). */
}

function mapHttpError(status: number, body: string): AppError {
  const detail = (() => {
    try {
      const j = JSON.parse(body);
      return String(j?.error?.message ?? "").slice(0, 200);
    } catch {
      return "";
    }
  })();
  if (status === 401 || status === 403) return new AppError(502, "ai_invalid_key", "OpenRouter rejected the API key (invalid, expired or not allowed for this model).");
  if (status === 402) return new AppError(502, "ai_no_credits", "OpenRouter reports insufficient credits for this key.");
  if (status === 429) return new AppError(503, "ai_rate_limited", "The AI service is rate limiting requests. Try again in a moment.");
  if (status === 404) return new AppError(502, "ai_no_provider", `No Google endpoint is available for this model right now. ${detail}`.trim());
  if (status >= 500) return new AppError(502, "ai_provider_error", `The AI provider had a problem (HTTP ${status}).`);
  return new AppError(502, "ai_bad_request", `The AI request was rejected (HTTP ${status}). ${detail}`.trim());
}

const transient = (status: number) => status === 429 || status >= 500;

/** One chat completion with provider pinning, structured output, retry/backoff and safe logging. */
export async function chat(opts: ChatOptions): Promise<ChatResult> {
  const cfg = opts.config ?? loadConfig();
  const f = opts.fetchImpl ?? fetch;
  const sleep: Sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const body = {
    model: cfg.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: 0,
    provider: { ...PROVIDER_ROUTING, ...(opts.schema ? { require_parameters: true } : {}) },
    ...(opts.schema
      ? { response_format: { type: "json_schema", json_schema: { name: opts.schema.name, strict: true, schema: opts.schema.schema } } }
      : {}),
  };

  const started = performance.now();
  let lastErr: AppError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 200));
    let res: Response;
    try {
      res = await f(`${cfg.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Hyped Stash",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 45_000),
      });
    } catch {
      lastErr = new AppError(502, "ai_network", "Could not reach the AI service (network or timeout).");
      continue;
    }
    const raw = await res.text();
    if (!res.ok) {
      lastErr = mapHttpError(res.status, raw);
      if (transient(res.status)) continue;
      throw logAndReturn(lastErr, cfg.model, opts.feature, started, attempt + 1);
    }
    let json: { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; model?: string; usage?: Usage; error?: { message?: string; code?: number } };
    try {
      json = JSON.parse(raw);
    } catch {
      lastErr = new AppError(502, "ai_invalid", "The AI service returned a malformed response.");
      continue;
    }
    // OpenRouter can return 200 with an error body for upstream failures
    if (json.error) {
      const code = Number(json.error.code) || 502;
      lastErr = mapHttpError(code, JSON.stringify({ error: json.error }));
      if (transient(code)) continue;
      throw logAndReturn(lastErr, cfg.model, opts.feature, started, attempt + 1);
    }
    const content = json.choices?.[0]?.message?.content;
    const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c?.text ?? "").join("") : "";
    if (!text.trim()) {
      lastErr = new AppError(502, "ai_invalid", "The AI service returned an empty response.");
      continue;
    }
    const durationMs = Math.round(performance.now() - started);
    log({ feature: opts.feature, model: json.model ?? cfg.model, durationMs, attempts: attempt + 1, usage: json.usage ?? null, ok: true });
    return { text, model: json.model ?? cfg.model, usage: json.usage ?? null, durationMs, attempts: attempt + 1 };
  }
  throw logAndReturn(lastErr ?? new AppError(502, "ai_provider_error", "AI request failed"), cfg.model, opts.feature, started, MAX_RETRIES + 1);
}

function logAndReturn(e: AppError, model: string, feature: string | undefined, started: number, attempts: number) {
  log({ feature, model, durationMs: Math.round(performance.now() - started), attempts, ok: false, code: e.code });
  return e;
}

/** Operational log line: model, timing, token usage, outcome. Never prompts, responses, keys or customer data. */
function log(entry: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test") return;
  console.info("[ai]", JSON.stringify(entry));
}

/** Ask for JSON and validate it with Zod; one repair-free attempt (malformed output is surfaced, never trusted). */
export async function chatJson<T extends z.ZodType>(
  zodSchema: T,
  schemaName: string,
  jsonSchema: Record<string, unknown>,
  opts: Omit<ChatOptions, "schema">,
): Promise<{ data: z.infer<T>; raw: unknown; meta: Omit<ChatResult, "text"> }> {
  const r = await chat({ ...opts, schema: { name: schemaName, schema: toStrictSchema(jsonSchema) } });
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new AppError(502, "ai_invalid", "The AI returned text that is not valid JSON.");
  }
  const v = zodSchema.safeParse(parsed);
  if (!v.success) throw new AppError(502, "ai_invalid", "The AI returned JSON that does not match the expected structure.", v.error.issues.slice(0, 5));
  const { text: _t, ...meta } = r;
  void _t;
  return { data: v.data, raw: parsed, meta };
}

/** Make a JSON Schema satisfy strict mode: every property required, no extra properties, no defaults. */
export function toStrictSchema<T>(node: T): T {
  if (Array.isArray(node)) return node.map(toStrictSchema) as unknown as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "default" || k === "$schema" || k === "minimum" || k === "maximum" || k === "maxLength" || k === "format") continue;
      out[k] = toStrictSchema(v);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.required = Object.keys(out.properties as object);
      out.additionalProperties = false;
    }
    return out as T;
  }
  return node;
}

export interface ModelInfo {
  id: string;
  inputModalities: string[];
  structuredOutputs: boolean;
}

/** Check https://openrouter.ai/api/v1/models for the model before relying on it. */
export async function checkModel(model: string, baseUrl = DEFAULT_BASE_URL, f: typeof fetch = fetch): Promise<ModelInfo | null> {
  const res = await f(`${baseUrl}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new AppError(502, "ai_provider_error", `Could not list OpenRouter models (HTTP ${res.status}).`);
  const j = (await res.json()) as { data?: { id: string; architecture?: { input_modalities?: string[] }; supported_parameters?: string[] }[] };
  const m = j.data?.find((x) => x.id === model);
  if (!m) return null;
  return { id: m.id, inputModalities: m.architecture?.input_modalities ?? [], structuredOutputs: (m.supported_parameters ?? []).includes("structured_outputs") };
}

export const imageDataUrl = (mediaType: string, base64: string): ContentPart => ({ type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } });
