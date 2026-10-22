import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db";
import { createUser, login, sessionFromToken, type Role } from "@/lib/auth";
import { resetRateLimits } from "@/lib/rate-limit";
import { createPurchase, addProductImage, updateProduct } from "@/lib/services/inventory";
import { createPartner } from "@/lib/services/partners";
import { saveImage } from "@/lib/storage";
import { key, testDb } from "./helpers";

import { GET as stockGET } from "@/app/api/inventory/stock/route";
import { POST as logPOST } from "@/app/api/log/route";
import { GET as analyticsGET } from "@/app/api/analytics/route";
import { GET as partnersGET } from "@/app/api/partners/route";
import { GET as partnerOneGET } from "@/app/api/partners/[id]/route";
import { POST as distPOST } from "@/app/api/partners/[id]/distributions/route";
import { GET as publicList } from "@/app/api/public/products/route";
import { GET as publicOne } from "@/app/api/public/products/[id]/route";
import { GET as fileGET } from "@/app/api/files/[key]/route";
import { PUT as settingsPUT } from "@/app/api/settings/route";

let db: DB, close: () => Promise<void>;
const sessions: Record<string, { cookie: string; csrf: string; id: string }> = {};
const base = "http://localhost";

async function mk(role: Role, partnerId?: string) {
  const email = `${role}-${Math.random().toString(36).slice(2)}@t.test`;
  const pw = "Passw0rd-" + Math.random().toString(36).slice(2);
  await createUser(db, { email, name: role, password: pw, role, partnerId });
  const l = await login(db, email, pw, "1.1.1.1");
  const s = (await sessionFromToken(db, l.token))!;
  sessions[role] = { cookie: `kl_session=${l.token}`, csrf: s.csrfToken, id: l.user.id };
  return sessions[role];
}

const req = (path: string, init: RequestInit & { as?: string; csrf?: boolean } = {}) => {
  const s = init.as ? sessions[init.as] : null;
  const headers = new Headers(init.headers);
  if (s) headers.set("cookie", s.cookie);
  if (s && init.csrf !== false && init.method && init.method !== "GET") headers.set("x-csrf-token", s.csrf);
  return new Request(base + path, { ...init, headers });
};
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

beforeAll(async () => {
  const t = await testDb();
  db = t.db;
  close = t.close;
  (globalThis as unknown as { __kicklogDb: Promise<DB> }).__kicklogDb = Promise.resolve(db);
  resetRateLimits();
});
afterAll(() => close());

describe("authentication and authorisation", () => {
  it("rejects anonymous access to protected endpoints", async () => {
    expect((await stockGET(req("/api/inventory/stock"))).status).toBe(401);
    expect((await analyticsGET(req("/api/analytics"))).status).toBe(401);
    expect((await partnersGET(req("/api/partners"))).status).toBe(401);
  });

  it("viewer is read-only; partner cannot touch business data", async () => {
    await mk("viewer");
    const p = await createPartner(db, { name: "Pat Partner" });
    await mk("partner", p.id);
    await mk("owner");
    await mk("admin");

    expect((await stockGET(req("/api/inventory/stock", { as: "viewer" }))).status).toBe(200);
    const fd = new FormData();
    fd.set("text", "Bought x size 9 for 5k");
    fd.set("idempotencyKey", key());
    expect((await logPOST(req("/api/log", { as: "viewer", method: "POST", body: fd }))).status).toBe(403);

    expect((await stockGET(req("/api/inventory/stock", { as: "partner" }))).status).toBe(403);
    expect((await analyticsGET(req("/api/analytics", { as: "partner" }))).status).toBe(403);
    expect((await settingsPUT(req("/api/settings", { as: "admin", method: "PUT", body: "{}" }))).status).toBe(403);
  });

  it("rejects mutating requests without a valid CSRF token", async () => {
    const fd = new FormData();
    fd.set("text", "hello");
    fd.set("idempotencyKey", key());
    const r = await logPOST(req("/api/log", { as: "owner", method: "POST", body: fd, csrf: false }));
    expect(r.status).toBe(403);
    expect((await r.json()).error.message).toMatch(/CSRF/);
  });

  it("blocks cross-origin mutations", async () => {
    const fd = new FormData();
    fd.set("text", "hello");
    fd.set("idempotencyKey", key());
    const r = await logPOST(req("/api/log", { as: "owner", method: "POST", body: fd, headers: { origin: "https://evil.example", host: "localhost" } }));
    expect(r.status).toBe(403);
  });

  it("a partner sees only their own record; only the owner can pay out", async () => {
    const mine = await (await partnersGET(req("/api/partners", { as: "partner" }))).json();
    expect(mine.mine.partner.name).toBe("Pat Partner");
    expect(mine.ledger).toBeUndefined();
    const other = await createPartner(db, { name: "Someone Else" });
    expect((await partnerOneGET(req(`/api/partners/${other.id}`, { as: "partner" }), ctx({ id: other.id }))).status).toBe(403);
    const asAdmin = await distPOST(req(`/api/partners/${other.id}/distributions`, { as: "admin", method: "POST", body: JSON.stringify({ amountPaise: 100 }), headers: { "content-type": "application/json" } }), ctx({ id: other.id }));
    expect(asAdmin.status).toBe(403);
  });

  it("wrong password is rejected and rate limited", async () => {
    resetRateLimits();
    await createUser(db, { email: "rl@t.test", name: "RL", password: "Correct-Passw0rd", role: "viewer" });
    for (let i = 0; i < 8; i++) await expect(login(db, "rl@t.test", "nope", "9.9.9.9")).rejects.toMatchObject({ status: 401 });
    await expect(login(db, "rl@t.test", "Correct-Passw0rd", "9.9.9.9")).rejects.toMatchObject({ status: 429 });
    resetRateLimits();
  });
});

describe("public catalog never leaks private data", () => {
  let publishedId: string, draftId: string, soldOutId: string;
  beforeAll(async () => {
    const mkp = async (name: string, qty: number, price: number | null) =>
      createPurchase(db, { idempotencyKey: key(), product: { name, brand: "Nike", publicPricePaise: price }, size: "10", quantity: qty, totalCostPaise: 1_234_500 * qty, source: "manual" });
    const a = await mkp("Published Pair", 2, 2_500_000);
    await updateProduct(db, a.productId, { status: "published" });
    publishedId = a.productId;
    const b = await mkp("Draft Pair", 1, 2_000_000);
    draftId = b.productId;
    const c = await mkp("Sold Out Pair", 1, 2_000_000);
    await updateProduct(db, c.productId, { status: "published" });
    soldOutId = c.productId;
    await db.execute(`update inventory_lots set quantity_remaining = 0 where id = '${c.lotId}'` as never);
  });

  it("lists only published, in-stock, priced products", async () => {
    const body = await (await publicList(req("/api/public/products"))).json();
    const names = body.items.map((i: { name: string }) => i.name);
    expect(names).toContain("Published Pair");
    expect(names).not.toContain("Draft Pair");
    expect(names).not.toContain("Sold Out Pair");
  });

  it("exposes an allow-list of fields and no cost, profit, partner or buyer data", async () => {
    const raw = await (await publicList(req("/api/public/products"))).text();
    for (const forbidden of ["cost", "profit", "partner", "customer", "supplier", "1234500", "12345", "margin", "unitCost"]) {
      expect(raw.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
    const item = JSON.parse(raw).items[0];
    expect(Object.keys(item).sort()).toEqual(["brand", "category", "colorway", "condition", "createdAt", "description", "id", "images", "name", "pricePaise", "sizes", "sku"]);
  });

  it("detail page hides drafts and sold-out products", async () => {
    expect((await publicOne(req(`/api/public/products/${publishedId}`), ctx({ id: publishedId }))).status).toBe(200);
    expect((await publicOne(req(`/api/public/products/${draftId}`), ctx({ id: draftId }))).status).toBe(404);
    expect((await publicOne(req(`/api/public/products/${soldOutId}`), ctx({ id: soldOutId }))).status).toBe(404);
    expect((await publicOne(req("/api/public/products/not-a-uuid"), ctx({ id: "not-a-uuid" }))).status).toBe(404);
  });

  it("filters, search and sorting work on the public list", async () => {
    const q = await (await publicList(req("/api/public/products?q=published&size=10&sort=price_desc"))).json();
    expect(q.items).toHaveLength(1);
    expect((await (await publicList(req("/api/public/products?size=42"))).json()).items).toHaveLength(0);
  });
});

describe("uploaded files", () => {
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex");
  it("bills are private, product photos are public, junk is refused", async () => {
    const bill = await saveImage(png, "bill");
    const photo = await saveImage(png, "product");
    expect((await fileGET(req(`/api/files/${bill.key}`), ctx({ key: bill.key }))).status).toBe(404);
    expect((await fileGET(req(`/api/files/${bill.key}`, { as: "partner" }), ctx({ key: bill.key }))).status).toBe(404);
    expect((await fileGET(req(`/api/files/${bill.key}`, { as: "owner" }), ctx({ key: bill.key }))).status).toBe(200);
    expect((await fileGET(req(`/api/files/${photo.key}`), ctx({ key: photo.key }))).status).toBe(200);
    expect((await fileGET(req("/api/files/..%2f..%2fetc%2fpasswd"), ctx({ key: "../../etc/passwd" }))).status).toBe(404);
    await expect(saveImage(Buffer.from("<script>alert(1)</script> not an image"), "product")).rejects.toMatchObject({ status: 400 });
    const p = await createPurchase(db, { idempotencyKey: key(), product: { name: "Img" }, size: "9", quantity: 1, totalCostPaise: 1 });
    await addProductImage(db, p.productId, `/api/files/${photo.key}`);
  });
});
