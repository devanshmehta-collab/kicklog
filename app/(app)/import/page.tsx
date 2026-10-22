"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Field, Input, Select } from "@/components/ui/primitives";
import { ApiError, apiFetch } from "@/lib/client/api";
import type { ExtractedProduct } from "@/lib/services/imports";
import { rupeesToPaise } from "@/lib/money";

export default function ImportPage() {
  const [url, setUrl] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [importId, setImportId] = React.useState("");
  const [f, setF] = React.useState<Record<string, string> | null>(null);
  const [images, setImages] = React.useState<string[]>([]);
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [rights, setRights] = React.useState(false);
  const [saved, setSaved] = React.useState("");

  async function extract() {
    setBusy(true);
    setError("");
    setSaved("");
    setF(null);
    try {
      const r = await apiFetch<{ importId: string; extracted: ExtractedProduct }>("/api/import/extract", { method: "POST", json: { url } });
      const x = r.extracted;
      setImportId(r.importId);
      setImages(x.images);
      setPicked(new Set());
      setRights(false);
      setF({
        title: x.title, brand: x.brand ?? "", model: x.model ?? "", sku: x.sku ?? "", colorway: x.colorway ?? "", category: x.category ?? "sneakers",
        retail: x.retail_price_inr != null ? String(x.retail_price_inr) : "", price: "", market: x.market_price_inr != null ? String(x.market_price_inr) : "", sizes: x.sizes.join(", "),
      });
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!f) return;
    setError("");
    try {
      const p = await apiFetch<{ id: string }>(`/api/import/${importId}/save`, {
        method: "POST",
        json: {
          title: f.title, brand: f.brand || null, model: f.model || null, sku: f.sku || null, colorway: f.colorway || null, category: f.category,
          retailPricePaise: f.retail ? rupeesToPaise(Number(f.retail)) : null, publicPricePaise: f.price ? rupeesToPaise(Number(f.price)) : null,
          sizes: f.sizes.split(",").map((s) => s.trim()).filter(Boolean), imageUrls: [...picked], imageRightsConfirmed: rights,
        },
      });
      setSaved(p.id);
      setF(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x!, [k]: e.target.value }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI product import</h1>
        <p className="text-sm text-muted">Paste a StockX, GOAT, Nike or Farfetch link. Gemini reads the page and fills in catalogue details for you to review. Importing never creates stock — record a purchase when you actually own it.</p>
      </div>
      <Card className="p-4">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.nike.com/t/…" aria-label="Product URL" />
          <Button onClick={extract} disabled={busy || url.length < 10}>{busy ? "Reading page…" : "Extract"}</Button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      </Card>

      {saved && <Card className="p-4 text-sm">Saved as a <b>draft</b> catalogue product with no stock. Find it under <a className="underline" href="/inventory">Inventory</a>.</Card>}

      {f && (
        <Card>
          <CardHeader title="Review before saving" />
          <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
            <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={set("title")} /></Field>
            <Field label="Brand"><Input value={f.brand} onChange={set("brand")} /></Field>
            <Field label="Model"><Input value={f.model} onChange={set("model")} /></Field>
            <Field label="SKU / style code"><Input value={f.sku} onChange={set("sku")} /></Field>
            <Field label="Colorway"><Input value={f.colorway} onChange={set("colorway")} /></Field>
            <Field label="Category"><Select value={f.category} onChange={set("category")}>{["sneakers", "apparel", "watches", "bags", "accessories", "other"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Retail reference ₹"><Input value={f.retail} onChange={set("retail")} inputMode="decimal" /></Field>
            <Field label="Indicative market price ₹" hint="Reference only — not saved as your price"><Input value={f.market} readOnly /></Field>
            <Field label="Your public price ₹"><Input value={f.price} onChange={set("price")} inputMode="decimal" /></Field>
            <Field label="Sizes (comma separated)" className="sm:col-span-2"><Input value={f.sizes} onChange={set("sizes")} /></Field>
            {images.length > 0 && (
              <div className="sm:col-span-2">
                <div className="mb-2 text-xs font-medium text-muted">Candidate images (select to attach)</div>
                <div className="flex flex-wrap gap-2">
                  {images.map((u) => (
                    <button key={u} type="button" onClick={() => setPicked((s) => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; })} className={`overflow-hidden rounded-lg border-2 ${picked.has(u) ? "border-fg" : "border-line"}`} aria-pressed={picked.has(u)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt="Candidate" referrerPolicy="no-referrer" className="h-20 w-20 object-cover" />
                    </button>
                  ))}
                </div>
                {picked.size > 0 && (
                  <label className="mt-3 flex items-start gap-2 text-xs text-muted"><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-0.5" /> I have the right to use these images (e.g. permission from the owner). Retailer and marketplace photos are usually copyrighted; when in doubt, upload your own photos instead.</label>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button variant="ghost" onClick={() => setF(null)}>Discard</Button>
              <Button onClick={save} disabled={!f.title.trim() || (picked.size > 0 && !rights)}>Save as draft product</Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
