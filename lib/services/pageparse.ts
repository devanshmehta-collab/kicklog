/**
 * Deterministic product-data extraction from raw HTML: schema.org JSON-LD, Open Graph / product meta tags
 * and the <title>. No AI, no DOM library. Works on most shops because they publish this data for SEO and sharing.
 */

export interface ParsedPage {
  title: string | null;
  brand: string | null;
  sku: string | null;
  model: string | null;
  colorway: string | null;
  category: string | null;
  description: string | null;
  price: number | null;
  currency: string | null;
  images: string[];
  sizes: string[];
  /** true when structured product data (JSON-LD Product) was found, i.e. high confidence */
  structured: boolean;
  /** readable page text (trimmed) for optional AI enrichment */
  text: string;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#x27": "'", "#x2F": "/" };
export const decodeEntities = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const clean = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 300) : null;
};

function metaTags(html: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const val = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    const v = val ? (val[1] ?? val[2]) : null;
    if (key && v) out.set(key, [...(out.get(key) ?? []), decodeEntities(v).trim()]);
  }
  return out;
}

function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const push = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(push);
    if (n && typeof n === "object") {
      nodes.push(n as Record<string, unknown>);
      const g = (n as Record<string, unknown>)["@graph"];
      if (g) push(g);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      push(JSON.parse(m[1].trim()));
    } catch {
      // some sites ship slightly broken JSON-LD; ignore that block
    }
  }
  return nodes;
}

const typeOf = (n: Record<string, unknown>) => ([] as unknown[]).concat(n["@type"] ?? []).map(String);
const text = (v: unknown): string | null => (typeof v === "string" ? clean(v) : v && typeof v === "object" ? clean((v as Record<string, unknown>).name) : null);

function imagesOf(v: unknown): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string") out.push(x);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object") walk((x as Record<string, unknown>).url ?? (x as Record<string, unknown>).contentUrl);
  };
  walk(v);
  return out;
}

function offersOf(v: unknown): { price: number | null; currency: string | null; sizes: string[] } {
  const offers = ([] as unknown[]).concat(v ?? []).flatMap((o) => {
    const obj = o as Record<string, unknown>;
    return obj && Array.isArray(obj.offers) ? (obj.offers as unknown[]) : [o];
  }) as Record<string, unknown>[];
  let price: number | null = null;
  let currency: string | null = null;
  const sizes: string[] = [];
  for (const o of offers) {
    if (!o || typeof o !== "object") continue;
    const p = Number(String(o.price ?? o.lowPrice ?? "").replace(/,/g, ""));
    if (price == null && Number.isFinite(p) && p > 0) price = p;
    currency ??= clean(o.priceCurrency);
    const sz = clean(o.size ?? (o.itemOffered as Record<string, unknown> | undefined)?.size);
    if (sz && !/out.?of.?stock|soldout/i.test(String(o.availability ?? ""))) sizes.push(sz);
  }
  return { price, currency, sizes };
}

export function parseProductPage(html: string, baseUrl: string): ParsedPage {
  const head = html.length > 1_500_000 ? html.slice(0, 1_500_000) : html;
  const meta = metaTags(head);
  const m1 = (k: string) => clean(meta.get(k)?.[0]);

  let title: string | null = null;
  let brand: string | null = null;
  let sku: string | null = null;
  let model: string | null = null;
  let colorway: string | null = null;
  let category: string | null = null;
  let description: string | null = null;
  let price: number | null = null;
  let currency: string | null = null;
  const images: string[] = [];
  const sizes: string[] = [];
  let structured = false;

  const nodes = jsonLdNodes(head);
  const products = nodes.filter((n) => typeOf(n).some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(t)));
  for (const p of products) {
    structured = true;
    title ??= text(p.name);
    brand ??= text(p.brand);
    sku ??= clean(p.sku) ?? clean(p.mpn) ?? clean(p.productID);
    model ??= clean(p.model);
    colorway ??= clean(p.color);
    category ??= clean(p.category);
    description ??= clean(p.description);
    images.push(...imagesOf(p.image));
    const off = offersOf(p.offers);
    price ??= off.price;
    currency ??= off.currency;
    sizes.push(...off.sizes);
    for (const v of ([] as unknown[]).concat(p.hasVariant ?? [])) {
      const vo = v as Record<string, unknown>;
      const s = clean(vo?.size);
      if (s) sizes.push(s);
      const vp = offersOf(vo?.offers);
      price ??= vp.price;
      currency ??= vp.currency;
    }
  }

  // Open Graph / product meta fall-backs
  title ??= m1("og:title") ?? m1("twitter:title") ?? clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1]);
  description ??= m1("og:description") ?? m1("description") ?? m1("twitter:description");
  brand ??= m1("product:brand") ?? m1("og:brand");
  if (price == null) {
    const p = Number((m1("product:price:amount") ?? m1("og:price:amount") ?? m1("price") ?? "").replace(/,/g, ""));
    if (Number.isFinite(p) && p > 0) price = p;
  }
  currency ??= m1("product:price:currency") ?? m1("og:price:currency") ?? m1("pricecurrency");
  images.push(...(meta.get("og:image") ?? []), ...(meta.get("og:image:secure_url") ?? []), ...(meta.get("twitter:image") ?? []), ...(meta.get("twitter:image:src") ?? []));

  // Titles often end with "| Store name": trim a trailing site suffix only when we did not get a structured name
  if (!structured && title) title = title.replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, "") || title;

  const abs = new Set<string>();
  for (const raw of images) {
    try {
      const u = new URL(raw.trim(), baseUrl);
      if (u.protocol === "https:" || u.protocol === "http:") {
        u.protocol = "https:";
        abs.add(u.toString());
      }
    } catch {
      // skip malformed URLs
    }
  }

  const body = head
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return {
    title,
    brand,
    sku,
    model,
    colorway,
    category,
    description,
    price,
    currency: currency?.toUpperCase() ?? null,
    images: [...abs].slice(0, 12),
    sizes: [...new Set(sizes)].slice(0, 40),
    structured,
    text: decodeEntities(body).replace(/\s+/g, " ").trim().slice(0, 6000),
  };
}

/** Signals that a page is a bot wall / captcha rather than a product page. */
export function looksBlocked(status: number, html: string): boolean {
  if ([401, 403, 429, 503].includes(status)) return true;
  return /captcha|access denied|verify you are (a )?human|enable javascript and cookies|attention required|px-captcha|just a moment/i.test(html.slice(0, 6000)) && html.length < 60_000;
}
