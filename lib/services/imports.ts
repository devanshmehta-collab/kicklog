import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { DB } from "../db";
import { productImports, productImages, products } from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { findOrCreateVariant, normalizeKey } from "./inventory";
import { getSettings } from "./settings";
import { eq } from "drizzle-orm";

/**
 * AI Product Import: Gemini reads a supported product page and returns catalogue data.
 * It is metadata only — importing never creates stock. Stock exists only after a purchase is recorded.
 */

export function validateImportUrl(raw: string, allowedHosts: string[]): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest("That is not a valid URL");
  }
  if (u.protocol !== "https:") throw badRequest("Only https:// links are supported");
  if (u.username || u.password) throw badRequest("URLs with credentials are not allowed");
  if (u.port && u.port !== "443") throw badRequest("Custom ports are not allowed");
  const host = u.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.includes(":") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) {
    throw badRequest("IP addresses and local hosts are not allowed");
  }
  if (!allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) {
    throw badRequest(`Unsupported site. Supported: ${allowedHosts.join(", ")}`);
  }
  return u;
}

const price = z.number().finite().nonnegative().nullish();
export const ExtractedProductSchema = z.object({
  title: z.string().min(1).max(300),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  sku: z.string().nullish(),
  colorway: z.string().nullish(),
  category: z.string().nullish(),
  retail_price_inr: price,
  market_price_inr: price,
  images: z.array(z.string().url().startsWith("https://")).max(12).default([]),
  sizes: z.array(z.string().max(20)).max(60).default([]),
});
export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;

export type Extractor = (url: string) => Promise<unknown>;

const PROMPT = (url: string) => `Open this product page and extract catalogue data: ${url}
Return ONLY a JSON object with keys: title, brand, model, sku, colorway, category (one of sneakers, apparel, watches, bags, accessories, other), retail_price_inr (number, retail/MSRP in INR if shown or convertible, else null), market_price_inr (indicative market/last-sale price in INR, else null), images (array of https image URLs of the product), sizes (array of size labels).
Use null for anything not on the page. Never invent values. If the page cannot be read, return {"title": ""}.`;

export const geminiExtractor: Extractor = async (url) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AppError(503, "ai_unconfigured", "GEMINI_API_KEY is not configured on the server");
  const ai = new GoogleGenAI({ apiKey: key });
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  // Google answers 503/429 during demand spikes; those are temporary, so retry with a short backoff.
  let res: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await ai.models.generateContent({ model, contents: PROMPT(url), config: { tools: [{ urlContext: {} }] } });
      break;
    } catch (e) {
      const err = e as { status?: number | string; message?: string };
      const busy = err.status === 503 || err.status === 429 || err.status === "UNAVAILABLE" || /"code":\s*(503|429)|UNAVAILABLE|high demand/i.test(err.message ?? "");
      if (!busy) throw new AppError(502, "ai_error", `Gemini request failed: ${(err.message ?? "unknown error").slice(0, 200)}`);
      if (attempt === 3) throw new AppError(503, "ai_busy", "Google's AI is overloaded right now. Please try again in a minute.");
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt)); // 1.5s, 3s, 6s
    }
  }
  const text = (res?.text ?? "").trim();
  const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  } catch {
    throw new AppError(502, "ai_invalid", "Gemini returned something that is not valid JSON");
  }
};

export async function extractProduct(db: DB, rawUrl: string, userId: string, extractor: Extractor = geminiExtractor) {
  const settings = await getSettings(db);
  const url = validateImportUrl(rawUrl, settings.importAllowedHosts);
  let extracted: ExtractedProduct | null = null;
  let error: string | null = null;
  try {
    extracted = ExtractedProductSchema.parse(await extractor(url.toString()));
  } catch (e) {
    error = e instanceof z.ZodError ? "Could not read product details from that page" : (e as Error).message;
  }
  const [row] = await db
    .insert(productImports)
    .values({ url: url.toString(), status: extracted ? "extracted" : "failed", extracted: extracted as Record<string, unknown> | null, error, createdBy: userId })
    .returning();
  if (!extracted) throw new AppError(422, "import_failed", error ?? "Import failed");
  return { importId: row.id, extracted };
}

export const ImportSaveSchema = z.object({
  title: z.string().trim().min(1).max(300),
  brand: z.string().trim().nullish(),
  model: z.string().trim().nullish(),
  sku: z.string().trim().nullish(),
  colorway: z.string().trim().nullish(),
  category: z.string().trim().default("sneakers"),
  retailPricePaise: z.number().int().nonnegative().nullish(),
  publicPricePaise: z.number().int().nonnegative().nullish(),
  sizes: z.array(z.string().trim().min(1)).default([]),
  /** Images are only attached when the user confirms they hold the rights to use them. */
  imageUrls: z.array(z.string().url().startsWith("https://")).default([]),
  imageRightsConfirmed: z.boolean().default(false),
});

/** Save the reviewed import as a DRAFT catalogue product with no stock. */
export async function saveImport(db: DB, importId: string, input: z.infer<typeof ImportSaveSchema>) {
  const [imp] = await db.select().from(productImports).where(eq(productImports.id, importId));
  if (!imp) throw notFound("Import not found");
  if (imp.productId) throw badRequest("This import was already saved");
  if (input.imageUrls.length && !input.imageRightsConfirmed) {
    throw badRequest("Confirm you have the rights to use these images, or remove them");
  }
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(products)
      .values({
        name: input.title,
        brand: input.brand ?? null,
        model: input.model ?? null,
        sku: input.sku ?? null,
        colorway: input.colorway ?? null,
        category: input.category,
        matchKey: normalizeKey(input.title),
        retailPricePaise: input.retailPricePaise ?? null,
        publicPricePaise: input.publicPricePaise ?? null,
        status: "draft",
      })
      .returning();
    for (const s of input.sizes) await findOrCreateVariant(tx, p.id, s);
    if (input.imageUrls.length) {
      await tx.insert(productImages).values(input.imageUrls.map((url, i) => ({ productId: p.id, url, position: i, isPrimary: i === 0 })));
    }
    await tx.update(productImports).set({ productId: p.id, status: "saved" }).where(eq(productImports.id, importId));
    return p;
  });
}

