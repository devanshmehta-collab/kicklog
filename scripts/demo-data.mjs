// Fills a running dev server with published demo products + generated placeholder photos, so the showroom has something to show.
// Usage: BASE=http://localhost:3001 DEMO_EMAIL=... DEMO_PASSWORD=... node scripts/demo-data.mjs
// (defaults to OWNER_EMAIL / OWNER_PASSWORD from .env.local). Placeholder images are plain gradients, replace them with real photos.
import fs from "node:fs";
import zlib from "node:zlib";

const BASE = process.env.BASE || "http://localhost:3000";
const env = Object.fromEntries(
  (fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8") : "").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const EMAIL = process.env.DEMO_EMAIL || env.OWNER_EMAIL;
const PASSWORD = process.env.DEMO_PASSWORD || env.OWNER_PASSWORD;

let cookie = "";
let csrf = "";
async function call(path, init = {}) {
  const headers = { ...(init.headers || {}), cookie, ...(init.method && init.method !== "GET" ? { "x-csrf-token": csrf } : {}) };
  const res = await fetch(BASE + path, { ...init, headers });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${body?.error?.message}`);
  return body;
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// --- tiny PNG encoder: a vertical gradient with a soft diagonal highlight ---
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(w, h, top, bottom, glow) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = y / h;
      const d = Math.abs(x / w - 0.35 - (1 - y / h) * 0.4); // diagonal band
      const g = Math.max(0, 1 - d * 5) * 0.28;
      for (let i = 0; i < 3; i++) {
        const v = top[i] + (bottom[i] - top[i]) * t + (glow[i] - 40) * g;
        raw[y * (w * 3 + 1) + 1 + x * 3 + i] = Math.max(0, Math.min(255, Math.round(v)));
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const PRODUCTS = [
  { name: "Air Jordan 1 High Chicago", brand: "Jordan", category: "sneakers", colorway: "White / Varsity Red", sku: "DZ5485-612", price: 2400000, cost: 1800000, sizes: ["8", "9", "10", "11"], c: [[200, 40, 40], [30, 20, 24], [255, 255, 255]] },
  { name: "Nike Dunk Low Panda", brand: "Nike", category: "sneakers", colorway: "White / Black", sku: "DD1391-100", price: 1450000, cost: 1100000, sizes: ["7", "8", "9", "10"], c: [[60, 60, 64], [12, 12, 14], [230, 230, 230]] },
  { name: "Yeezy Boost 350 V2 Zebra", brand: "Adidas", category: "sneakers", colorway: "White / Core Black", sku: "CP9654", price: 1850000, cost: 1400000, sizes: ["8", "9", "10"], c: [[120, 110, 100], [20, 18, 16], [255, 240, 220]] },
  { name: "Rolex Datejust 41", brand: "Rolex", category: "watches", colorway: "Steel / Slate dial", sku: "126300", price: 1050000000, cost: 920000000, sizes: ["41mm"], c: [[70, 90, 110], [10, 14, 20], [210, 230, 255]] },
  { name: "Louis Vuitton Neverfull MM", brand: "Louis Vuitton", category: "bags", colorway: "Damier Ebene", sku: "N41358", price: 8500000, cost: 6200000, sizes: ["OS"], c: [[150, 110, 60], [28, 20, 12], [255, 220, 160]] },
  { name: "Supreme Box Logo Hoodie", brand: "Supreme", category: "apparel", colorway: "Black", sku: "FW23-BOX", price: 1850000, cost: 1300000, sizes: ["M", "L", "XL"], c: [[90, 30, 30], [14, 10, 10], [255, 200, 200]] },
];

await call("/api/auth/login", json({ email: EMAIL, password: PASSWORD }));
csrf = (await call("/api/auth/me")).csrfToken;
const existing = (await call("/api/products")).map((p) => p.name);

for (const p of PRODUCTS) {
  if (existing.includes(p.name)) continue;
  const keys = [];
  for (let i = 0; i < 2; i++) {
    const [top, bottom, glow] = p.c;
    const img = png(480, 600, i ? bottom : top, i ? top : bottom, glow);
    const fd = new FormData();
    fd.set("file", new Blob([img], { type: "image/png" }), "demo.png");
    keys.push((await call("/api/uploads", { method: "POST", body: fd })).key);
  }
  await call(
    "/api/products",
    json({
      name: p.name, brand: p.brand, category: p.category, colorway: p.colorway, sku: p.sku,
      condition: "new", publicPricePaise: p.price, status: "published", imageKeys: keys,
      lots: p.sizes.map((size) => ({ size, quantity: 1, unitCostPaise: p.cost })),
    }),
  );
  console.log("created", p.name);
}
console.log("done");
