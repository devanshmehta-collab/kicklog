import { GoogleGenAI } from "@google/genai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { productImages, productImports, products } from "../db/schema";
import { AppError, badRequest, notFound } from "../errors";
import { findOrCreateVariant, normalizeKey } from "./inventory";
import { parseProductPage, looksBlocked } from "./pageparse";
import { fetchHtml, validateImportUrl } from "./webfetch";

/**
 * AI Product Import. Works with any public website:
 *   1. read the page ourselves (safely) and pull structured data (JSON-LD / Open Graph) — fast, no AI needed;
 *   2. let Gemini fill any gaps from the page text;
 *   3. if the site blocks us, fall back to Gemini's own page reader;
 *   4. if everything is blocked, say so plainly so details can be typed in by hand.
 * It is metadata only — importing never creates stock. Stock exists only after a purchase is recorded.
 */

export { validateImportUrl };

const price = z.number().finite().nonnegative().nullish();
export const ExtractedProductSchema = z.object({
  title: z.string().min(1).max(300),
  brand: z.string().nullish(),
  model: z.string().nullish(),
  sku: z.string().nullish(),
  colorway: z.string().nullish(),
  category: z.string().nullish(),
  description: z.string().nullish(),
  retail_price_inr: price,
  market_price_inr: price,
  /** Price shown on the page when it is not in INR (we do not guess exchange rates). */
  price_original: price,
  price_currency: z.string().max(8).nullish(),
  images: z.array(z.string().url().startsWith("https://")).max(12).default([]),
  sizes: z.array(z.string().max(20)).max(60).default([]),
  source: z.enum(["page-data", "page-data+ai", "ai"]).nullish(),
});
export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;

export type Extractor = (url: string) => Promise<unknown>;

// ───────────── Gemini helpers ─────────────
const MODEL = () => process.env.GEMINI_MODEL || "gemini-3.8-flash";

async function geminiJson(contents: string, opts: { urlContext?: boolean; attempts?: number } = {}): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AppError(503, "ai_unconfigured", "GEMINI_API_KEY is not configured on the server");
  const ai = new GoogleGenAI({ apiKey: key });
  const attempts = opts.attempts ?? 3;
  let text = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL(),
        contents,
        config: opts.urlContext ? { tools: [{ urlContext: {} }] } : { responseMimeType: "application/json" },
      });
      text = (res.text ?? "").trim();
      break;
    } catch (e) {
      const err = e as { status?: number | string; message?: string };
      const busy = err.status === 503 || err.status === 429 || err.status === "UNAVAILABLE" || /"code":\s*(503|429)|UNAVAILABLE|high demand/i.test(err.message ?? "");
      if (!busy) throw new AppError(502, "ai_error", `Gemini request failed: ${(err.message ?? "unknown error").slice(0, 200)}`);
      if (attempt === attempts - 1) throw new AppError(503, "ai_busy", "Google's AI is overloaded right now. Please try again in a minute.");
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
  const json = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(json.slice(json.indexOf("{"), json.lastIndexOf("}") + 1));
  } catch {
    throw new AppError(502, "ai_invalid", "Gemini returned something that is not valid JSON");
  }
}

const FIELDS = `title, brand, model, sku, colorway, category (one of sneakers, apparel, watches, bags, accessories, other), retail_price_inr (number in INR only if the page shows INR, else null), market_price_inr (indicative market/last-sale price in INR, else null), images (array of https image URLs of the product), sizes (array of size labels)`;

/** Fallback: ask Gemini to open the page itself (works on some sites that block our fetch). */
async function geminiReadsPage(url: string) {
  const out = (await geminiJson(
    `Open this product page and extract catalogue data: ${url}\nReturn ONLY a JSON object with keys: ${FIELDS}.\nUse null for anything not on the page. Never invent values. If the page cannot be read, return {"title": ""}.`,
    { urlContext: true },
  )) as Record<string, unknown>;
  return { ...out, source: "ai" };
}

/** Fill gaps in what the page itself told us, using only text that is actually on the page. */
async function enrich(base: Record<string, unknown>, pageText: string) {
  const missing = ["brand", "model", "sku", "colorway", "category", "sizes"].filter((k) => base[k] == null || (Array.isArray(base[k]) && !(base[k] as unknown[]).length));
  if (!missing.length || !process.env.GEMINI_API_KEY) return base;
  try {
    const ai = (await geminiJson(
      `You are completing a product record from a web page.\nKnown so far: ${JSON.stringify({ title: base.title, brand: base.brand, sku: base.sku })}\nPage text: """${pageText}"""\nReturn ONLY JSON with keys: ${missing.join(", ")}. category must be one of sneakers, apparel, watches, bags, accessories, other. sizes is an array of size labels offered. Use null (or []) when the text does not clearly say. Never invent values.`,
      { attempts: 1 },
    )) as Record<string, unknown>;
    const merged = { ...base };
    for (const k of missing) {
      const v = ai[k];
      if (k === "sizes") {
        if (Array.isArray(v) && v.length) merged.sizes = v.filter((x) => typeof x === "string" || typeof x === "number").map(String).slice(0, 40);
      } else if (typeof v === "string" && v.trim()) merged[k] = v.trim().slice(0, 200);
    }
    merged.source = "page-data+ai";
    return merged;
  } catch {
    return base; // enrichment is a bonus; never fail the import because of it
  }
}

export const smartExtractor: Extractor = async (url) => {
  let reason = "";
  try {
    const page = await fetchHtml(url);
    if (looksBlocked(page.status, page.html)) {
      reason = "blocked";
    } else if (page.status >= 400) {
      reason = page.status === 404 ? "notfound" : "error";
    } else {
      const p = parseProductPage(page.html, page.url);
      if (p.title && (p.structured || p.price != null || p.images.length)) {
        const inr = p.currency === "INR" || p.currency === "₹";
        const base: Record<string, unknown> = {
          title: p.title,
          brand: p.brand,
          model: p.model,
          sku: p.sku,
          colorway: p.colorway,
          category: p.category ? p.category.toLowerCase() : null,
          description: p.description,
          retail_price_inr: inr ? p.price : null,
          price_original: !inr ? p.price : null,
          price_currency: !inr ? p.currency : null,
          images: p.images,
          sizes: p.sizes,
          source: "page-data",
        };
        return await enrich(base, p.text);
      }
      reason = "noproduct";
    }
  } catch (e) {
    if (e instanceof AppError && e.status === 400) throw e; // unsafe / invalid URL: stop, do not retry through Gemini
    reason = "unreachable";
  }

  // The page could not be read directly: let Gemini try with its own reader.
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = (await geminiReadsPage(url)) as { title?: string };
      if (r.title && String(r.title).trim()) return r;
    } catch (e) {
      if (e instanceof AppError && e.code === "ai_busy") throw e;
    }
  }
  const why: Record<string, string> = {
    blocked: "This website blocks automated readers (it showed a security check), so the details could not be fetched.",
    notfound: "That page was not found (404). Check the link.",
    noproduct: "That page did not look like a product page. Open a single product and copy its link.",
    unreachable: "The website could not be reached or took too long to answer.",
    error: "The website returned an error.",
  };
  throw new AppError(422, "import_failed", `${why[reason] ?? "Could not read that page."} You can still add the product by typing its details in below.`);
};

export async function extractProduct(db: DB, rawUrl: string, userId: string, extractor: Extractor = smartExtractor) {
  const url = validateImportUrl(rawUrl);
  let extracted: ExtractedProduct | null = null;
  let error: string | null = null;
  try {
    extracted = ExtractedProductSchema.parse(await extractor(url.toString()));
  } catch (e) {
    if (e instanceof AppError && e.status === 400) throw e;
    error = e instanceof z.ZodError ? "Could not read product details from that page. You can still add the product by typing its details in below." : (e as Error).message;
  }
  const [row] = await db
    .insert(productImports)
    .values({ url: url.toString(), status: extracted ? "extracted" : "failed", extracted: extracted as Record<string, unknown> | null, error, createdBy: userId })
    .returning();
  if (!extracted) throw new AppError(422, "import_failed", error ?? "Import failed", { importId: row.id });
  return { importId: row.id, extracted };
}

export const ImportSaveSchema = z.object({
  title: z.string().trim().min(1).max(300),
  brand: z.string().trim().nullish(),
  model: z.string().trim().nullish(),
  sku: z.string().trim().nullish(),
  colorway: z.string().trim().nullish(),
  category: z.string().trim().default("sneakers"),
  description: z.string().trim().max(4000).nullish(),
  retailPricePaise: z.number().int().nonnegative().nullish(),
  publicPricePaise: z.number().int().nonnegative().nullish(),
  sizes: z.array(z.string().trim().min(1)).default([]),
  /** Images are only attached when the user confirms they hold the rights to use them. */
  imageUrls: z.array(z.string().url().startsWith("https://")).default([]),
  imageRightsConfirmed: z.boolean().default(false),
});

/** Create a bare import record for manual entry when a site could not be read. */
export async function startManualImport(db: DB, rawUrl: string | null, userId: string) {
  const [row] = await db
    .insert(productImports)
    .values({ url: rawUrl ?? "manual", status: "manual", extracted: null, createdBy: userId })
    .returning();
  return row.id;
}

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
        description: input.description ?? null,
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
