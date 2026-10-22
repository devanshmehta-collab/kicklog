import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchHtml, generateContent } = vi.hoisted(() => ({ fetchHtml: vi.fn(), generateContent: vi.fn() }));
vi.mock("@/lib/services/webfetch", async (orig) => ({ ...(await orig<typeof import("@/lib/services/webfetch")>()), fetchHtml }));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { models = { generateContent }; } }));

import { looksBlocked, parseProductPage } from "@/lib/services/pageparse";
import { smartExtractor } from "@/lib/services/imports";
import { isPublicIp, safeLookup } from "@/lib/services/webfetch";

const JSONLD = `<html><head><title>Nike Dunk Low Retro | Nike IN</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"Nike Dunk Low Retro &amp; Panda","brand":{"@type":"Brand","name":"Nike"},"sku":"DD1391-100","color":"White/Black","image":["/img/a.jpg","https://cdn.example.com/b.jpg"],"offers":{"@type":"Offer","priceCurrency":"INR","price":"10,795"}}</script>
</head><body><h1>Dunk</h1></body></html>`;

const OG_ONLY = `<html><head><title>Cool Hoodie – Some Store</title>
<meta property="og:title" content="Cool Hoodie – Some Store"><meta property="og:image" content="https://shop.example.com/h.jpg">
<meta property="product:price:amount" content="49.99"><meta property="product:price:currency" content="USD"></head><body>Sizes S M L</body></html>`;

describe("page parsing", () => {
  it("reads schema.org JSON-LD, decodes entities and resolves relative image URLs", () => {
    const p = parseProductPage(JSONLD, "https://www.nike.com/in/t/dunk");
    expect(p).toMatchObject({ title: "Nike Dunk Low Retro & Panda", brand: "Nike", sku: "DD1391-100", colorway: "White/Black", price: 10795, currency: "INR", structured: true });
    expect(p.images).toEqual(["https://www.nike.com/img/a.jpg", "https://cdn.example.com/b.jpg"]);
  });
  it("falls back to Open Graph / product meta tags", () => {
    const p = parseProductPage(OG_ONLY, "https://shop.example.com/p/1");
    expect(p).toMatchObject({ title: "Cool Hoodie", price: 49.99, currency: "USD", structured: false });
    expect(p.images).toEqual(["https://shop.example.com/h.jpg"]);
  });
  it("survives broken JSON-LD and empty pages", () => {
    expect(parseProductPage('<script type="application/ld+json">{oops</script>', "https://x.com").title).toBeNull();
    expect(parseProductPage("", "https://x.com").images).toEqual([]);
  });
  it("detects bot walls", () => {
    expect(looksBlocked(403, "")).toBe(true);
    expect(looksBlocked(200, "<html>Just a moment... captcha</html>")).toBe(true);
    expect(looksBlocked(200, JSONLD)).toBe(false);
  });
});

describe("SSRF protection", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1"])("%s is not public", (ip) => expect(isPublicIp(ip)).toBe(false));
  it.each(["8.8.8.8", "1.1.1.1", "142.250.80.46", "172.32.0.1", "2606:4700:4700::1111"])("%s is public", (ip) => expect(isPublicIp(ip)).toBe(true));

  it("refuses to connect when a hostname resolves to a private address (DNS rebinding defence)", async () => {
    const lookup = ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, [{ address: "10.0.0.7", family: 4 }])) as never;
    const err = await new Promise<NodeJS.ErrnoException>((res) => (safeLookup(lookup) as never as (h: string, o: object, cb: (e: NodeJS.ErrnoException) => void) => void)("evil.example", {}, res));
    expect(err.code).toBe("EBLOCKED");
  });
  it("allows a hostname that resolves to a public address", async () => {
    const lookup = ((_h: string, _o: unknown, cb: (...a: unknown[]) => void) => cb(null, [{ address: "93.184.216.34", family: 4 }])) as never;
    const out = await new Promise<{ err: unknown; addr: unknown }>((res) => (safeLookup(lookup) as never as (h: string, o: object, cb: (e: unknown, a: unknown) => void) => void)("ok.example", { all: true }, (err, addr) => res({ err, addr })));
    expect(out.err).toBeNull();
    expect(out.addr).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});

describe("smart extractor", () => {
  beforeEach(() => {
    fetchHtml.mockReset();
    generateContent.mockReset();
    delete process.env.GEMINI_API_KEY;
  });

  it("imports from page data alone, with no AI call", async () => {
    fetchHtml.mockResolvedValue({ url: "https://www.nike.com/in/t/dunk", status: 200, html: JSONLD, contentType: "text/html" });
    const r = (await smartExtractor("https://www.nike.com/in/t/dunk")) as Record<string, unknown>;
    expect(r).toMatchObject({ title: "Nike Dunk Low Retro & Panda", retail_price_inr: 10795, source: "page-data" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("keeps foreign prices as a note instead of guessing an exchange rate", async () => {
    fetchHtml.mockResolvedValue({ url: "https://shop.example.com/p/1", status: 200, html: OG_ONLY, contentType: "text/html" });
    const r = (await smartExtractor("https://shop.example.com/p/1")) as Record<string, unknown>;
    expect(r).toMatchObject({ retail_price_inr: null, price_original: 49.99, price_currency: "USD" });
  });

  it("uses Gemini only to fill gaps, and ignores its failures", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchHtml.mockResolvedValue({ url: "https://shop.example.com/p/1", status: 200, html: OG_ONLY, contentType: "text/html" });
    generateContent.mockResolvedValue({ text: JSON.stringify({ brand: "Acme", category: "apparel", sizes: ["S", "M", "L"], colorway: null }) });
    const r = (await smartExtractor("https://shop.example.com/p/1")) as Record<string, unknown>;
    expect(r).toMatchObject({ brand: "Acme", category: "apparel", sizes: ["S", "M", "L"], source: "page-data+ai" });
    generateContent.mockRejectedValue({ status: 500, message: "boom" });
    expect(((await smartExtractor("https://shop.example.com/p/1")) as { title: string }).title).toBe("Cool Hoodie");
  });

  it("falls back to Gemini's own page reader when the site blocks us", async () => {
    process.env.GEMINI_API_KEY = "k";
    fetchHtml.mockResolvedValue({ url: "https://x.com/p", status: 403, html: "", contentType: "text/html" });
    generateContent.mockResolvedValue({ text: JSON.stringify({ title: "Read by Gemini", images: [], sizes: [] }) });
    const r = (await smartExtractor("https://x.com/p")) as Record<string, unknown>;
    expect(r).toMatchObject({ title: "Read by Gemini", source: "ai" });
    expect(generateContent.mock.calls[0][0].config.tools).toEqual([{ urlContext: {} }]);
  });

  it("explains plainly when nothing can read the site, and offers manual entry", async () => {
    fetchHtml.mockResolvedValue({ url: "https://x.com/p", status: 403, html: "", contentType: "text/html" });
    await expect(smartExtractor("https://x.com/p")).rejects.toMatchObject({ status: 422, message: expect.stringMatching(/blocks automated readers.*typing its details/) });
  });

  it("never falls back to Gemini for unsafe addresses", async () => {
    process.env.GEMINI_API_KEY = "k";
    const { badRequest } = await import("@/lib/errors");
    fetchHtml.mockRejectedValue(badRequest("Private or local addresses are not allowed"));
    await expect(smartExtractor("https://evil.example/x")).rejects.toMatchObject({ status: 400 });
    expect(generateContent).not.toHaveBeenCalled();
  });
});
