"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, Empty, Input, Money } from "@/components/ui/primitives";
import { ApiError, apiFetch, useGet } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import { useQueryClient } from "@tanstack/react-query";
import type { ProductLite } from "@/components/product-forms";

interface Row extends ProductLite {
  units: number;
  sizes: string[];
  imageUrl: string | null;
}

export default function CatalogManager() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const products = useGet<Row[]>(["products"], "/api/products");
  const qc = useQueryClient();
  const [err, setErr] = React.useState("");
  const [copied, setCopied] = React.useState("");

  async function patch(id: string, body: Record<string, unknown>) {
    setErr("");
    try {
      await apiFetch(`/api/products/${id}`, { method: "PATCH", json: body });
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    }
  }
  async function upload(id: string, f: File | undefined) {
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    try {
      await apiFetch(`/api/products/${id}/images`, { method: "POST", body: fd });
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Upload failed");
    }
  }
  const live = (products.data ?? []).filter((p) => p.status === "published" && p.units > 0).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Public catalog</h1>
          <p className="text-sm text-muted">{live} products live. Only published products with stock and a price appear in the showroom — costs, profit and buyers are never exposed.</p>
        </div>
        <a href="/shop" target="_blank" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ExternalLink size={14} /> Open showroom</a>
      </div>
      {err && <p role="alert" className="text-sm text-loss">{err}</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {products.data?.filter((p) => p.status !== "archived").map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <div className="relative aspect-[4/3] bg-raised">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted">No photo</div>
              )}
              <Badge tone={p.status === "published" ? "gain" : "neutral"} className="absolute top-3 left-3">{p.status}</Badge>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{[p.brand, p.sku].filter(Boolean).join(" · ")} · {p.units} in stock · sizes {p.sizes.join(", ") || "—"}</div>
              </div>
              <PriceEditor key={p.publicPricePaise ?? "none"} value={p.publicPricePaise} disabled={!write} onSave={(paise) => patch(p.id, { publicPricePaise: paise })} />
              {write && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={p.status === "published" ? "secondary" : "primary"} onClick={() => patch(p.id, { status: p.status === "published" ? "draft" : "published" })}>
                    {p.status === "published" ? "Unpublish" : "Publish"}
                  </Button>
                  <label className="inline-flex h-8 cursor-pointer items-center rounded-xl border border-line px-3 text-sm text-muted hover:text-fg">
                    + Photo<input type="file" accept="image/*" className="hidden" onChange={(e) => upload(p.id, e.target.files?.[0])} />
                  </label>
                  {p.status === "published" && (
                    <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard?.writeText(`${location.origin}/shop/${p.id}`); setCopied(p.id); setTimeout(() => setCopied(""), 1500); }}>
                      {copied === p.id ? <Check size={14} /> : <Copy size={14} />} Link
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {products.data?.length === 0 && <Card><Empty>Add products in Inventory first.</Empty></Card>}
    </div>
  );
}

function PriceEditor({ value, onSave, disabled }: { value: number | null; onSave: (paise: number | null) => void; disabled: boolean }) {
  const [v, setV] = React.useState(value != null ? String(value / 100) : "");
  const dirty = v !== (value != null ? String(value / 100) : "");
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted">Public price ₹</span>
      <Input className="h-9 w-32" inputMode="decimal" value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} aria-label="Public price" />
      {dirty && <Button size="sm" onClick={() => onSave(v === "" ? null : rupeesToPaise(Number(v)))}>Save</Button>}
      {!dirty && value != null && <Money paise={value} className="ml-auto text-sm text-muted" />}
    </div>
  );
}
