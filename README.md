# KICK LOG — less logging, more selling

An AI-assisted inventory, sales, sourcing and finance platform for independent sneaker and luxury resellers.
Log a purchase or a sale with one sentence or a photo; the backend — not the model — decides what is safe to save and does all the maths.

> **Principle:** AI simplifies data entry. The backend controls the business.
> Claude only *interprets* text/photos into a structured guess. Zod validation, `lib/rules.ts`, and database transactions decide whether anything is saved, and `lib/profit.ts` computes every rupee.

## What's in the box

| Area | Where |
| --- | --- |
| Private terminal at `/dashboard` and friends (Overview + embedded Quick Log, Inventory, Sales, Customers, Sourcing, Partners, Analytics, Catalog manager, AI Import, Settings) | `app/(app)/*` |
| Public site: landing page `/`, showroom `/shop`, product pages `/shop/[id]` (filters, WhatsApp/phone enquiries) | `app/(public)/*` |
| AI Quick Log (server-side Claude, tool-use + Zod) | `app/api/log/route.ts`, `lib/ai/*`, `lib/services/quicklog.ts` |
| Needs Review queue (persisted in Postgres) | `lib/services/reviews.ts`, `app/api/reviews/*` |
| Business rules & auto-save gate | `lib/rules.ts` |
| Money maths (integer paise) | `lib/profit.ts`, `lib/money.ts` |
| Atomic sales, refunds, FIFO lots, partner allocation | `lib/services/sales.ts`, `inventory.ts`, `partners.ts` |
| Sourcing requests + landed cost | `lib/services/sourcing.ts`, `lib/profit.ts#computeLandedCost` |
| Gemini URL import | `lib/services/imports.ts` |
| Auth, sessions, CSRF, rate limits, audit log | `lib/auth.ts`, `lib/api.ts`, `lib/rate-limit.ts`, `lib/services/audit.ts` |
| Schema (25 tables) | `lib/db/schema.ts`, migrations in `drizzle/` |

## Quick start

Requirements: Node 20+ (developed on 24), and optionally PostgreSQL 14+.

```bash
npm install            # .npmrc sets legacy-peer-deps (see Notes)
cp .env.example .env.local
npm run dev            # http://localhost:3000  → consumer showroom; sellers sign in at /login → /dashboard
```

* **No `DATABASE_URL`?** Kick Log runs on an embedded PGlite database (real Postgres compiled to WASM) in `./.data/pglite`. Great for trying it out; use a real Postgres for production.
* **First visit:** `/login` shows a one-time "Create the owner account" form. Or set `OWNER_EMAIL` / `OWNER_PASSWORD` in `.env.local` to create the owner automatically.
* **No `ANTHROPIC_API_KEY`?** Quick Log will not be able to interpret anything — every submission is preserved in Needs Review so nothing is lost. To explore the full flow offline set `AI_MODE=mock` (dev only; ignored in production). It swaps Claude for a small regex parser, while every validation rule, transaction and profit calculation stays the real code path.
* Optional demo data: `npm run seed`, or with a dev server running, `BASE=http://localhost:3000 node scripts/demo-data.mjs` adds six published products with generated placeholder photos.
* Don't force-kill the dev server while using the embedded database; it can corrupt the PGlite files (delete `.data/` to reset). A real Postgres has no such issue.

### Environment variables

See [`.env.example`](.env.example). Secrets (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DATABASE_URL`, S3 keys) are read only on the server and are never prefixed `NEXT_PUBLIC_`.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. Omit for embedded PGlite (dev). |
| `AI_PROVIDER` | Optional: `anthropic` or `gemini`. By default Quick Log uses Claude when `ANTHROPIC_API_KEY` is set, otherwise Gemini. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Quick Log interpretation with Claude (paid API). Default model `claude-sonnet-5-5`; pick a smaller/faster model if latency matters. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI Product Import (uses Gemini's URL-context tool). |
| `AI_MODE` | `live` (default) or `mock` (dev/e2e only). |
| `OWNER_EMAIL`, `OWNER_PASSWORD`, `OWNER_NAME` | Optional first-run owner. |
| `STORAGE_DRIVER`, `S3_*` | `local` (`./uploads`) or any S3-compatible bucket. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Fallback WhatsApp number for the showroom (also editable in Settings). |

## How Quick Log decides

1. **Interpret** — server sends text, images (compressed in the browser), today's date and a compact list of in-stock items (id, name, brand, size, qty, colorway, SKU — **no costs or customers**) to Claude, forcing a `record_transaction` tool call. Large inventories are ranked by relevance, capped at 200 rows and flagged `PARTIAL` so the model never concludes an item doesn't exist just because it wasn't shown.
2. **Validate** — the result is parsed with Zod (`lib/ai/schema.ts`), then `lib/rules.ts` applies the gate:
   * **Purchase** auto-saves only if: type is purchase, confidence ≥ 0.85, product named, size present (for sized categories), cost present, quantity valid, shipping treatment unambiguous (included vs extra), per-unit vs total clear when qty > 1, date sane, image readable.
   * **Sale** auto-saves only if: type is sale, confidence ≥ 0.85, exactly one match that really exists in stock, quantity available, price present. Unspecified shipping/fees default to ₹0. If two items could match, or none, nothing is guessed.
3. **Save or park** — safe entries go through the *same* `createPurchase` / `recordSale` services as the manual forms. Everything else becomes a persistent **Needs Review** card with the original text, photo, extracted fields, missing info, confidence and candidate items. Stock and totals are untouched.
4. **Confirm** — editing a card and pressing *Confirm* re-runs validation against the live database (`confirmReview`) and only then creates the transaction (idempotent per review).

Every submission has an idempotency key; retrying (or double-clicking) returns the original outcome instead of duplicating. AI failures (timeout, bad structure, missing key) are stored as review items with the original input.

The UI shows real elapsed time (client wall clock + server processing). The < 10 s target is measured, not promised.

## Money

All amounts are integer **paise**. Profit is `net proceeds − COGS − selling expenses`, where net proceeds = price × qty − discount + shipping charged to the buyer, and selling expenses = outbound shipping + fees + other. Example: ₹22,000 − ₹18,000 − ₹500 = **₹3,500**.
"Incl. shipping" on a purchase means shipping is already inside the quoted cost and is *not* added again; "+₹500 delivery" is added once. International purchases use `computeLandedCost` (FX + freight + duty + fees, with per-component "already on the invoice" flags).
Unit costs are rounded to the nearest paisa per unit (a ₹1,000 lot of 3 → ₹333.33 each).

Refunds reverse revenue and profit one-for-one; restocked units get their COGS back, damaged units are written off (cost stays as a loss). Outbound shipping/fees already paid are treated as sunk. Partner allocations are reversed with matching negative rows, and a refund can never exceed what was received or the units sold.

## Security model

* Server-side sessions (random token, only its SHA-256 stored), `HttpOnly` + `SameSite=Lax` cookie (`Secure` in production), bcrypt password hashes, 14-day expiry.
* CSRF: every mutating API call needs the per-session `x-csrf-token` header **and** a same-origin `Origin`.
* Roles — **Owner** (everything, payouts, settings, users), **Admin** (all business operations), **Viewer** (read-only), **Partner** (only their own ledger).
* Zod validation on every body; per-user and per-IP rate limits (in-memory — put Redis behind it if you run several instances); audit log for sensitive actions.
* Uploads are validated by magic bytes and size, renamed to random keys, served with `nosniff` and a sandbox CSP. Bills (`b-*`) require a session; product photos (`p-*`) are public.
* The public catalog selects an explicit allow-list of columns — acquisition cost, profit, partners and buyers are never queried by those endpoints (covered by tests).
* Production sends a Content-Security-Policy; set a strong `OWNER_PASSWORD` or use the setup screen, and serve over HTTPS.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest: financial maths, rules, services against a real (PGlite) Postgres engine, API authorisation, catalog leak checks, import validation, sourcing workflow, React Testing Library UI test |
| `npm run test:e2e` | Playwright (spins up its own server on :3100 with `AI_MODE=mock` and a throw-away database). First time: `npx playwright install chromium` |
| `node scripts/smoke.mjs` | HTTP smoke test of the three non-negotiable Quick Log scenarios against a running server |
| `npm run db:generate` | Generate a migration after editing `lib/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` (the app also applies them on start) |
| `npm run seed` | Demo data |

## Deployment

1. Provision PostgreSQL and set `DATABASE_URL`; set `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, and S3 variables if you deploy to a host with an ephemeral filesystem (Vercel, containers).
2. `npm run build && npm start` (Node host) or deploy to any platform that runs Next.js. Migrations run automatically on first connection; `npm run db:migrate` runs them explicitly in CI/CD.
3. Create the owner on first visit, set the WhatsApp number in **Settings**, publish products from **Catalog**.
4. Replace the in-memory rate limiter if you run more than one instance.

## Notes and known limits

* **UI components** are shadcn-style (Tailwind + `class-variance-authority`, hand-authored in `components/ui`) rather than generated by the shadcn CLI, and don't pull in Radix.
* `.npmrc` sets `legacy-peer-deps=true`: `@hookform/resolvers@6` declares an optional peer on a newer `effect` than its other optional peers allow, and npm's resolver refuses to install without it. `react-is`, `vite` and `@testing-library/dom` are therefore listed explicitly.
* Sizes are free text (`10`, `UK 9`, `M`, `41mm`); "10" and "UK 10" are different variants.
* Changing a lot's partner ownership affects future sales only; past allocations are history.
* Gemini import relies on Gemini's URL-context tool to fetch pages (so site access rules are applied on Google's side), restricts hosts to an allow-list, never stores images unless you confirm you have the rights, and never creates stock.

## What has and hasn't been verified

Verified in this repo: all unit/integration/UI tests, the Playwright e2e suite (desktop + mobile viewport), TypeScript, the production build, and an HTTP smoke test of the Quick Log scenarios, all against PGlite and `AI_MODE=mock`.

**Not verified (no credentials/infrastructure were available):** real Claude calls (prompt quality, latency and the < 10 s target with a live model), Gemini import against live sites, the node-postgres driver against a server PostgreSQL (same SQL and the same engine as PGlite, but not run), and the S3 storage driver.
Before relying on it, run `node scripts/smoke.mjs` against a deployment with real keys and try the "bad input" cases with real photos.

## Deploying to Vercel (checklist)

Vercel's disk is read-only and temporary, so the embedded dev database and local `uploads/` folder **cannot work there**. A page showing "This page couldn't load / A server error occurred" right after deploying almost always means one of these is missing. Set them in *Project → Settings → Environment Variables*, then redeploy:

| Variable | Why |
| --- | --- |
| `DATABASE_URL` | **Required.** A hosted PostgreSQL (Neon, Supabase, Vercel Postgres). Use the pooled connection string with `sslmode=require`. |
| `ANTHROPIC_API_KEY` | Quick Log. Without it submissions are kept in Needs Review. |
| `STORAGE_DRIVER=s3` + `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required to upload product photos and bills (Cloudflare R2, S3, Supabase Storage all work). |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | Optional: creates the owner on first visit. Otherwise `/login` shows the setup form. |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | Fallback WhatsApp number (also editable in Settings). |

Tables are created automatically on the first request; or run `DATABASE_URL=... npm run db:migrate` once from your machine. Do **not** set `AI_MODE=mock` in production (it is ignored there). The actual error for any failing page is in *Vercel → Deployments → Functions/Runtime Logs*.
