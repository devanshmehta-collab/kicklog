import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import { badRequest } from "../errors";

/**
 * Safe server-side page fetching for the product importer. Works for any public website, but can never be
 * pointed at the server's own network: every address a host resolves to is checked at connect time
 * (which also defeats DNS rebinding), redirects are re-validated hop by hop, and size/time are capped.
 */

export function isPublicIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast / reserved
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return false;
    if (v.startsWith("fc") || v.startsWith("fd")) return false; // unique local
    if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return false; // link-local
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    return true;
  }
  return false;
}

/** Cheap syntactic checks before any network call. */
export function validateImportUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest("That is not a valid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw badRequest("Only web links (https://) are supported");
  if (u.username || u.password) throw badRequest("URLs with credentials are not allowed");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".localhost")) {
    throw badRequest("Local addresses are not allowed");
  }
  if (net.isIP(host.replace(/^\[|\]$/g, "")) && !isPublicIp(host.replace(/^\[|\]$/g, ""))) {
    throw badRequest("Private or local addresses are not allowed");
  }
  if (!host.includes(".") && !net.isIP(host.replace(/^\[|\]$/g, ""))) throw badRequest("That does not look like a website address");
  return u;
}

type LookupFn = typeof dns.lookup;

/** A dns.lookup replacement that refuses to connect to non-public addresses. */
export function safeLookup(inner: LookupFn = dns.lookup): typeof dns.lookup {
  return ((hostname: string, options: dns.LookupOptions | number | undefined, cb: (...a: unknown[]) => void) => {
    const opts = typeof options === "object" && options ? { ...options } : { family: typeof options === "number" ? options : 0 };
    inner(hostname, { ...opts, all: true } as dns.LookupAllOptions, ((err: Error | null, addrs: dns.LookupAddress[]) => {
      if (err) return cb(err);
      const bad = addrs.find((a) => !isPublicIp(a.address));
      if (bad || !addrs.length) return cb(Object.assign(new Error("Blocked: address is not public"), { code: "EBLOCKED" }));
      if ((opts as dns.LookupOptions).all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    }) as never);
  }) as unknown as typeof dns.lookup;
}

export interface FetchedPage {
  url: string;
  status: number;
  html: string;
  contentType: string;
}

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  lookup?: typeof dns.lookup;
  /** Test seam: replace the transport. */
  request?: typeof https.request;
}

const UA = "Mozilla/5.0 (compatible; KickLogImporter/1.0; +product-catalogue-import) AppleWebKit/537.36 Chrome/120 Safari/537.36";

/** GET a page as HTML. Throws a friendly AppError for anything that is not a readable public HTML page. */
export async function fetchHtml(rawUrl: string, opts: FetchOptions = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 9000;
  const maxBytes = opts.maxBytes ?? 2_500_000;
  const maxRedirects = opts.maxRedirects ?? 5;
  const lookup = safeLookup(opts.lookup);
  let url = validateImportUrl(rawUrl);
  const deadline = Date.now() + timeoutMs;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await once(url, { lookup, deadline, maxBytes, request: opts.request });
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = validateImportUrl(new URL(res.location, url).toString());
      continue;
    }
    return { url: url.toString(), status: res.status, html: res.body, contentType: res.contentType };
  }
  throw badRequest("The link redirects too many times");
}

function once(url: URL, o: { lookup: typeof dns.lookup; deadline: number; maxBytes: number; request?: typeof https.request }) {
  return new Promise<{ status: number; body: string; location?: string; contentType: string }>((resolve, reject) => {
    const mod = url.protocol === "http:" ? http : https;
    const send = (url.protocol === "https:" && o.request ? o.request : mod.request) as typeof https.request;
    const remaining = Math.max(1000, o.deadline - Date.now());
    const req = send(
      url,
      {
        method: "GET",
        lookup: o.lookup as never,
        timeout: remaining,
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en-IN,en;q=0.9", "Accept-Encoding": "gzip, deflate, br" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        const location = typeof res.headers.location === "string" ? res.headers.location : undefined;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, body: "", location, contentType });
        }
        if (contentType && !/html|xml|text\/plain/i.test(contentType)) {
          res.resume();
          return reject(Object.assign(badRequest("That link is not a web page (it looks like a file or image)"), { status }));
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream = enc.includes("br") ? res.pipe(zlib.createBrotliDecompress()) : enc.includes("gzip") ? res.pipe(zlib.createGunzip()) : enc.includes("deflate") ? res.pipe(zlib.createInflate()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (c: Buffer) => {
          size += c.length;
          if (size > o.maxBytes) {
            req.destroy();
            return resolve({ status, body: Buffer.concat(chunks).toString("utf8"), contentType }); // enough to read the head of the page
          }
          chunks.push(c);
        });
        stream.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8"), contentType }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    req.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EBLOCKED") return reject(badRequest("Private or local addresses are not allowed"));
      if (e.code === "ETIMEDOUT" || e.code === "ECONNRESET") return reject(Object.assign(new Error("The website did not respond in time"), { transient: true }));
      if (e.code === "ENOTFOUND" || e.code === "EAI_AGAIN") return reject(badRequest("That website address could not be found"));
      reject(Object.assign(new Error(`Could not reach the website (${e.code ?? e.message})`), { transient: true }));
    });
    req.end();
  });
}
