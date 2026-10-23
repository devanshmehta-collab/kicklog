"use client";

import { PencilLine } from "lucide-react";
import * as React from "react";
import { SizePicker } from "@/components/size-picker";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import type { ExtractedProduct } from "@/lib/services/imports";

const BLANK = { title: "", brand: "", model: "", sku: "", colorway: "", category: "sneakers", description: "", retail: "", price: "", market: "", sizes: "", note: "" };

export default function ImportPage() {
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [importId, setImportId] = React.useState("");
  const [f, setF] = React.useState<Record<string, string> | null>(null);
  const [source, setSource] = React.useState<string | null>(null);
  const [images, setImages] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [rights, setRights] = React.useState(false);
  const [saved, setSaved] = React.useState<{ id: string; published: boolean; units: number } | null>(null);
  const [stock, setStock] = React.useState<Record<string, { qty: string; cost: string }>>({});
  const [sharedCost, setSharedCost] = React.useState("");
  const [publish, setPublish] = React.useState(false);

  function reset() {
    setError("");
    setSaved(null);
    setStock({});
    setSharedCost("");
    setPublish(false);
    setF(null);
  }

  async function extract() {
    setBusy(true);
    reset();
    try {
      const r = await apiFetch<{ importId: string; extracted: ExtractedProduct }>("/api/import/extract", { method: "POST", json: { url } });
      const x = r.extracted;
      setImportId(r.importId);
      setSource(x.source ?? null);
      setImages(x.images);
      setPicked(new Set());
      setRights(false);
      setF({
        ...BLANK,
        title: x.title,
        brand: x.brand ?? "",
        model: x.model ?? "",
        sku: x.sku ?? "",
        colorway: x.colorway ?? "",
        category: x.category && ["sneakers", "apparel", "watches", "bags", "accessories", "other"].includes(x.category) ? x.category : "sneakers",
        description: x.description ?? "",
        retail: x.retail_price_inr != null ? String(x.retail_price_inr) : "",
        market: x.market_price_inr != null ? String(x.market_price_inr) : "",
        sizes: x.sizes.join(", "),
        note: x.price_original != null ? `Page price: ${x.price_currency ?? ""} ${x.price_original} (not converted)` : "",
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function manual() {
    setBusy(true);
    reset();
    try {
      const r = await apiFetch<{ importId: string }>("/api/import/manual", { method: "POST", json: {} });
      setImportId(r.importId);
      setSource(null);
      setImages([]);
      setPicked(new Set());
      setF({ ...BLANK });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start");
    } finally {
      setBusy(false);
    }
  }

  const sizeList = f ? f.sizes.split(",").map((x) => x.trim()).filter(Boolean) : [];
  const unitsOf = (sz: string) => Math.max(0, Math.floor(Number(stock[sz]?.qty) || 0));
  const totalUnits = sizeList.reduce((a, sz) => a + unitsOf(sz), 0);
  const setStockRow = (sz: string, patch: Partial<{ qty: string; cost: string }>) => setStock((r) => ({ ...r, [sz]: { qty: r[sz]?.qty ?? "", cost: r[sz]?.cost ?? sharedCost, ...patch } }));
  const applyShared = (v: string) => {
    setSharedCost(v);
    setStock((r) => Object.fromEntries(sizeList.map((sz) => [sz, { qty: r[sz]?.qty ?? "", cost: v }])));
  };
  const canPublish = !!f && !!f.price.trim() && totalUnits > 0;

  async function save() {
    if (!f) return;
    setError("");
    const lots: { size: string; quantity: number; unitCostPaise: number }[] = [];
    for (const sz of sizeList) {
      const q = unitsOf(sz);
      if (!q) continue;
      const cost = (stock[sz]?.cost ?? sharedCost).trim();
      if (!cost || !Number.isFinite(Number(cost)) || Number(cost) < 0) return setError(`Enter what each unit of size ${sz} cost you.`);
      lots.push({ size: sz, quantity: q, unitCostPaise: rupeesToPaise(Number(cost)) });
    }
    try {
      const p = await apiFetch<{ id: string; status: string }>(`/api/import/${importId}/save`, {
        method: "POST",
        json: {
          title: f.title,
          brand: f.brand || null,
          model: f.model || null,
          sku: f.sku || null,
          colorway: f.colorway || null,
          category: f.category,
          description: f.description || null,
          retailPricePaise: f.retail ? rupeesToPaise(Number(f.retail)) : null,
          publicPricePaise: f.price ? rupeesToPaise(Number(f.price)) : null,
          sizes: f.sizes.split(",").map((s) => s.trim()).filter(Boolean),
          imageUrls: [...picked],
          imageRightsConfirmed: rights,
          lots,
          publish: publish && canPublish,
        },
      });
      setSaved({ id: p.id, published: p.status === "published", units: lots.reduce((a, l) => a + l.quantity, 0) });
      setF(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x!, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Product import</h1>
        <p className="text-sm text-muted">Paste a product link from any website. Kick Log reads the page, fills in the details, and you review before saving. Only units you enter below become stock.</p>
      </div>
      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.length > 9 && !busy && extract()} placeholder="https://… any product page" aria-label="Product URL" />
          <Button onClick={extract} disabled={busy || url.length < 10}>{busy ? "Reading page…" : "Import"}</Button>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          <span>Some big brands (Nike, Adidas, StockX…) block automated readers. If that happens, type the details in instead.</span>
          <button onClick={manual} disabled={busy} className="inline-flex items-center gap-1.5 text-fg underline-offset-4 hover:underline">
            <PencilLine size={13} /> Enter details manually
          </button>
        </div>
        {error && (
          <div role="alert" className="mt-3 rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">
            {error}
            <div className="mt-2">
              <Button size="sm" variant="secondary" onClick={manual}>Enter details manually</Button>
            </div>
          </div>
        )}
      </Card>

      {saved && (
        <Card className={`p-4 text-sm ${saved.published ? "border-gain/30 bg-gain/5" : ""}`}>
          {saved.published ? (
            <>
              <b>Published.</b> {saved.units} unit{saved.units === 1 ? "" : "s"} in stock and live on your website. <a className="underline" href="/" target="_blank">View the shop</a> · <a className="underline" href="/inventory">Inventory</a>
            </>
          ) : (
            <>
              Saved as a <b>draft</b>{saved.units > 0 ? ` with ${saved.units} unit${saved.units === 1 ? "" : "s"} in stock` : " with no stock"}. Add photos and publish it from <a className="underline" href="/catalog-manager">Catalog</a>, or find it under <a className="underline" href="/inventory">Inventory</a>.
            </>
          )}
        </Card>
      )}

      {f && (
        <Card>
          <CardHeader title="Review before saving" action={source && <Badge>{source === "ai" ? "Read by AI" : source === "page-data+ai" ? "Page data + AI" : "Page data"}</Badge>} />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={set("title")} /></Field>
            <Field label="Brand"><Input value={f.brand} onChange={set("brand")} /></Field>
            <Field label="Model"><Input value={f.model} onChange={set("model")} /></Field>
            <Field label="SKU / style code"><Input value={f.sku} onChange={set("sku")} /></Field>
            <Field label="Colorway"><Input value={f.colorway} onChange={set("colorway")} /></Field>
            <Field label="Category">
              <Select value={f.category} onChange={set("category")}>
                {["sneakers", "apparel", "watches", "bags", "accessories", "other"].map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Retail reference ₹" hint={f.note || undefined}><Input value={f.retail} onChange={set("retail")} inputMode="decimal" /></Field>
            {f.market && <Field label="Indicative market price ₹" hint="Reference only"><Input value={f.market} readOnly /></Field>}
            <Field label="Your public price ₹"><Input value={f.price} onChange={set("price")} inputMode="decimal" /></Field>
            <div className="sm:col-span-2">
              <SizePicker
                category={f.category}
                label="Sizes offered"
                selected={f.sizes.split(",").map((x) => x.trim()).filter(Boolean)}
                onToggle={(sz) => setF((x) => { const cur = x!.sizes.split(",").map((v) => v.trim()).filter(Boolean); return { ...x!, sizes: (cur.includes(sz) ? cur.filter((v) => v !== sz) : [...cur, sz]).join(", ") }; })}
              />
            </div>
            <section className="space-y-3 rounded-xl border border-line p-4 sm:col-span-2" aria-label="Stock and publishing">
              <div>
                <h4 className="text-sm font-semibold">Stock <span className="font-normal text-muted">· optional</span></h4>
                <p className="text-xs text-muted">Enter how many you own and what each cost you. Sizes left blank are listed as available variants but have no stock yet.</p>
              </div>
              {sizeList.length === 0 ? (
                <p className="text-sm text-muted">Pick the sizes above first.</p>
              ) : (
                <>
                  <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    Same cost per unit for all sizes ₹
                    <Input className="h-8 w-32" inputMode="decimal" placeholder="e.g. 8500" value={sharedCost} onChange={(e) => applyShared(e.target.value)} aria-label="Same cost per unit for every size" />
                  </label>
                  <div className="space-y-2">
                    {sizeList.map((sz) => (
                      <div key={sz} className="grid grid-cols-[56px_1fr_1fr] items-center gap-2">
                        <span className="rounded-lg bg-raised px-2 py-2 text-center text-sm font-medium">{sz}</span>
                        <Input inputMode="numeric" placeholder="Units" value={stock[sz]?.qty ?? ""} onChange={(e) => setStockRow(sz, { qty: e.target.value.replace(/[^\d]/g, "") })} aria-label={`Units of size ${sz}`} />
                        <Input inputMode="decimal" placeholder="Cost ₹ each" value={stock[sz]?.cost ?? sharedCost} onChange={(e) => setStockRow(sz, { cost: e.target.value })} aria-label={`Cost per unit of size ${sz}`} />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted">{totalUnits > 0 ? `${totalUnits} unit${totalUnits === 1 ? "" : "s"} will be added to your inventory.` : "No units entered — nothing will be added to inventory."}</p>
                </>
              )}
              <label className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${canPublish ? "border-line" : "border-line opacity-60"}`}>
                <input type="checkbox" className="mt-0.5" checked={publish && canPublish} disabled={!canPublish} onChange={(e) => setPublish(e.target.checked)} />
                <span>
                  <b>Publish to my website now</b>
                  <span className="block text-xs text-muted">
                    {canPublish ? "Customers will see it on the home page with the sizes you have in stock." : "Needs your public price and at least one unit in stock."}
                  </span>
                </span>
              </label>
            </section>
            <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={f.description} onChange={set("description")} /></Field>
            {images.length > 0 && (
              <div className="sm:col-span-2">
                <div className="mb-2 text-xs font-medium text-muted">Images found on the page (select to attach)</div>
                <div className="flex flex-wrap gap-2">
                  {images.map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setPicked((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; })}
                      className={`overflow-hidden rounded-lg border-2 ${picked.has(u) ? "border-fg" : "border-line"}`}
                      aria-pressed={picked.has(u)}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="Candidate" referrerPolicy="no-referrer" className="h-20 w-20 object-cover" />
                    </button>
                  ))}
                </div>
                {picked.size > 0 && (
                  <label className="mt-3 flex items-start gap-2 text-xs text-muted">
                    <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" /> I have the right to use these images (e.g. permission from the owner). Retailer and marketplace photos are usually copyrighted; when in doubt, upload your own photos instead.
                  </label>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setF(null)}>Discard</Button>
              <Button onClick={save} disabled={!f.title.trim() || (picked.size > 0 && !rights)}>{publish && canPublish ? "Save & publish" : totalUnits > 0 ? "Save with stock" : "Save as draft"}</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
