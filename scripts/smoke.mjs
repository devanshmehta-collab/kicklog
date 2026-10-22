// HTTP smoke test of the three non-negotiable Quick Log scenarios against a running server.
// Usage: BASE=http://localhost:3000 node scripts/smoke.mjs   (server should run with AI_MODE=mock, or a real ANTHROPIC_API_KEY)
const BASE = process.env.BASE || "http://localhost:3000";
const EMAIL = process.env.SMOKE_EMAIL || `smoke-${Date.now()}@kicklog.test`;
const PASSWORD = process.env.SMOKE_PASSWORD || `Smoke-${Math.random().toString(36).slice(2)}9x`;

let cookie = "";
let csrf = "";

async function call(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.headers || {}), cookie, ...(init.method && init.method !== "GET" ? { "x-csrf-token": csrf } : {}) } });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const log = async (text) => {
  const fd = new FormData();
  fd.set("text", text);
  fd.set("idempotencyKey", crypto.randomUUID());
  const t0 = performance.now();
  const r = await call("/api/log", { method: "POST", body: fd });
  return { ...r.body, wallMs: Math.round(performance.now() - t0), http: r.status };
};
const kpis = async () => (await call("/api/analytics")).body.kpis;

let failed = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} ${extra}`);
  if (!ok) failed++;
};

const me = await call("/api/auth/me");
if (me.body?.needsSetup) {
  const s = await call("/api/auth/setup", json({ email: EMAIL, name: "Smoke", password: PASSWORD }));
  if (s.status !== 200) throw new Error("setup failed " + JSON.stringify(s.body));
} else if (me.status === 401) {
  const l = await call("/api/auth/login", json({ email: EMAIL, password: PASSWORD }));
  if (l.status !== 200) throw new Error("Server already has users. Set SMOKE_EMAIL / SMOKE_PASSWORD.");
}
csrf = (await call("/api/auth/me")).body.csrfToken;

const before = await kpis();
const t1 = await log("Bought AJ1 Chicago size 10 for ₹18,000 incl shipping.");
check("Test 1: purchase saved", t1.status === "saved", `(${t1.wallMs}ms wall, ${t1.elapsedMs}ms server) ${t1.message}`);
const stock = (await call("/api/inventory/stock")).body;
const row = stock.find((s) => s.name.includes("Chicago") && s.size === "10");
check("Test 1: appears in stock at ₹18,000", !!row && row.avgUnitCostPaise === 1_800_000);

const afterBuy = await kpis();
check("Test 1: in-stock units +1", afterBuy.unitsInStock === before.unitsInStock + 1);

const t2 = await log("Sold the Chicago 10s for ₹22,000, ₹500 shipping.");
check("Test 2: sale saved", t2.status === "saved", `(${t2.wallMs}ms) ${t2.message}`);
check("Test 2: profit = ₹3,500", t2.profitPaise === 350_000);
const afterSale = await kpis();
check("Test 2: realised profit +₹3,500 exactly", afterSale.realizedNetProfitPaise - afterBuy.realizedNetProfitPaise === 350_000);
check("Test 2: in-stock units −1", afterSale.unitsInStock === afterBuy.unitsInStock - 1);

const snapshot = await kpis();
for (const text of ["hello", "Sold the Yeezy 350 for 15k"]) {
  const r = await log(text);
  check(`Test 3: "${text}" → needs_review`, r.status === "needs_review" && !!r.reviewId);
}
const after = await kpis();
check("Test 3: no inventory or financial change", after.unitsInStock === snapshot.unitsInStock && after.realizedNetProfitPaise === snapshot.realizedNetProfitPaise);
const open = (await call("/api/reviews")).body;
check("Test 3: review records persisted", open.length >= 2);

console.log(failed ? `\n${failed} check(s) failed` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
