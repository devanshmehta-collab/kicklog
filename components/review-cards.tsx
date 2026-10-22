"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil, Trash2 } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, Field, Input, Select } from "@/components/ui/primitives";
import type { ReviewFields } from "@/lib/ai/schema";
import { ApiError, apiFetch, useGet } from "@/lib/client/api";
import type { StockRow } from "@/lib/services/inventory";

export interface ReviewRow {
  id: string;
  inputText: string;
  imageKeys: string[];
  interpretedType: string;
  extracted: ReviewFields;
  missing: string[];
  problems: string[];
  confidence: string | null;
  candidates: { variantId: string; name: string; size: string; quantity: number }[];
  createdAt: string;
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

export function ReviewCards({ canWrite }: { canWrite: boolean }) {
  const { data } = useGet<ReviewRow[]>(["reviews"], "/api/reviews");
  const stock = useGet<StockRow[]>(["stock"], "/api/inventory/stock");
  if (!data?.length) return null;
  return (
    <section aria-label="Needs review" className="space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-review" />
        <h2 className="text-sm font-semibold tracking-wide text-review uppercase">Needs Review</h2>
        <Badge tone="review">{data.length}</Badge>
        <span className="text-xs text-muted">Nothing below has touched your stock or profit yet.</span>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.map((r) => (
          <ReviewCard key={r.id} review={r} stock={stock.data ?? []} canWrite={canWrite} />
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ review, stock, canWrite }: { review: ReviewRow; stock: StockRow[]; canWrite: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState<ReviewFields>(() => ({
    type: review.extracted?.type ?? "unclear",
    purchase: review.extracted?.purchase ?? {},
    sale: review.extracted?.sale ?? {},
  }));
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string[]>(review.problems);
  const [editing, setEditing] = React.useState(review.interpretedType === "unclear" || review.problems.length > 0);

  const p = f.purchase ?? {};
  const s = f.sale ?? {};
  const setP = (patch: Record<string, unknown>) => setF((x) => ({ ...x, purchase: { ...(x.purchase ?? {}), ...patch } }));
  const setS = (patch: Record<string, unknown>) => setF((x) => ({ ...x, sale: { ...(x.sale ?? {}), ...patch } }));

  const candIds = new Set(review.candidates.map((c) => c.variantId));
  const options = [...stock.filter((x) => candIds.has(x.variantId)), ...stock.filter((x) => !candIds.has(x.variantId))];

  async function run(kind: "confirm" | "save" | "discard") {
    setBusy(true);
    try {
      if (kind === "discard") await apiFetch(`/api/reviews/${review.id}/discard`, { method: "POST", json: {} });
      else if (kind === "save") {
        const r = await apiFetch<{ evaluation: { problems: string[] } }>(`/api/reviews/${review.id}`, { method: "PATCH", json: f });
        setErrors(r.evaluation.problems);
        qc.invalidateQueries({ queryKey: ["reviews"] });
        setBusy(false);
        return;
      } else await apiFetch(`/api/reviews/${review.id}/confirm`, { method: "POST", json: { fields: f } });
      await qc.invalidateQueries();
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) setErrors((e.details as { problems?: string[] })?.problems ?? [e.message]);
      else setErrors([e instanceof Error ? e.message : "Failed"]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-review/40 bg-review/[0.04] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="review" className="capitalize">{f.type === "unclear" ? "Unclear" : f.type}</Badge>
            {review.confidence != null && <span className="text-xs text-muted num">AI confidence {(Number(review.confidence) * 100).toFixed(0)}%</span>}
            <span className="text-xs text-muted">{new Date(review.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span>
          </div>
          <p className="mt-2 text-sm break-words">
            {review.inputText ? <>&ldquo;{review.inputText}&rdquo;</> : <span className="text-muted">(photo only)</span>}
          </p>
        </div>
        {review.imageKeys.length > 0 && (
          <div className="flex shrink-0 gap-1.5">
            {review.imageKeys.slice(0, 3).map((k) => (
              <a key={k} href={`/api/files/${k}`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/files/${k}`} alt="Uploaded bill or photo" className="h-14 w-14 rounded-lg border border-line object-cover" />
              </a>
            ))}
          </div>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-lg bg-review/10 px-3 py-2 text-sm text-review">
          {errors.map((e) => (
            <li key={e}>• {e}</li>
          ))}
        </ul>
      )}
      {review.missing.length > 0 && <p className="mt-2 text-xs text-muted">Missing: {review.missing.join(", ")}</p>}

      {!editing ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={!canWrite}><Pencil size={14} /> Edit &amp; confirm</Button>
          <Button size="sm" variant="ghost" onClick={() => run("discard")} disabled={!canWrite || busy}><Trash2 size={14} /> Discard</Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex gap-2">
            {(["purchase", "sale"] as const).map((t) => (
              <button key={t} onClick={() => setF({ ...f, type: t })} className={`rounded-lg border px-3 py-1 text-sm capitalize ${f.type === t ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg"}`}>
                {t}
              </button>
            ))}
          </div>

          {f.type === "purchase" && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Product" className="col-span-2"><Input value={p.item ?? ""} onChange={(e) => setP({ item: e.target.value })} /></Field>
              <Field label="Brand"><Input value={p.brand ?? ""} onChange={(e) => setP({ brand: e.target.value || null })} /></Field>
              <Field label="Category">
                <Select value={p.category ?? ""} onChange={(e) => setP({ category: e.target.value || null })}>
                  <option value="">Select…</option>
                  {["sneakers", "apparel", "watches", "bags", "accessories", "other"].map((c) => <option key={c}>{c}</option>)}
                </Select>
              </Field>
              <Field label="Size / variant"><Input value={p.size ?? ""} onChange={(e) => setP({ size: e.target.value || null })} placeholder="10, M, 41mm…" /></Field>
              <Field label="Quantity"><Input inputMode="numeric" value={p.quantity ?? ""} onChange={(e) => setP({ quantity: num(e.target.value) })} /></Field>
              <Field label="Cost (₹)"><Input inputMode="decimal" value={p.cost_inr ?? ""} onChange={(e) => setP({ cost_inr: num(e.target.value) })} /></Field>
              <Field label="Cost is">
                <Select value={p.amount_basis ?? ""} onChange={(e) => setP({ amount_basis: e.target.value || null })}>
                  <option value="">Not sure</option><option value="per_unit">Per unit</option><option value="total">Total</option>
                </Select>
              </Field>
              <Field label="Shipping (₹)"><Input inputMode="decimal" value={p.shipping_inr ?? ""} onChange={(e) => setP({ shipping_inr: num(e.target.value) })} /></Field>
              <Field label="Shipping">
                <Select value={p.cost_includes_shipping == null ? "" : String(p.cost_includes_shipping)} onChange={(e) => setP({ cost_includes_shipping: e.target.value === "" ? null : e.target.value === "true" })}>
                  <option value="">Not stated</option><option value="true">Already in cost</option><option value="false">Extra on top</option>
                </Select>
              </Field>
            </div>
          )}

          {f.type === "sale" && (
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Item sold" className="col-span-2">
                <Select value={s.matched_item_id ?? ""} onChange={(e) => setS({ matched_item_id: e.target.value || null, other_possible_ids: [] })}>
                  <option value="">Choose from in-stock items…</option>
                  {options.map((o) => (
                    <option key={o.variantId} value={o.variantId}>
                      {candIds.has(o.variantId) ? "★ " : ""}{o.name} — size {o.size} ({o.quantity} in stock)
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Sale price (₹)"><Input inputMode="decimal" value={s.price_inr ?? ""} onChange={(e) => setS({ price_inr: num(e.target.value) })} /></Field>
              <Field label="Quantity"><Input inputMode="numeric" value={s.quantity ?? ""} onChange={(e) => setS({ quantity: num(e.target.value) })} /></Field>
              <Field label="Shipping you paid (₹)"><Input inputMode="decimal" value={s.shipping_inr ?? ""} onChange={(e) => setS({ shipping_inr: num(e.target.value) })} /></Field>
              <Field label="Fees (₹)"><Input inputMode="decimal" value={s.fees_inr ?? ""} onChange={(e) => setS({ fees_inr: num(e.target.value) })} /></Field>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => run("confirm")} disabled={busy || f.type === "unclear"}><Check size={14} /> Confirm &amp; save</Button>
            <Button size="sm" variant="secondary" onClick={() => run("save")} disabled={busy}>Save edits</Button>
            <Button size="sm" variant="ghost" onClick={() => run("discard")} disabled={busy}><Trash2 size={14} /> Discard</Button>
          </div>
        </div>
      )}
    </Card>
  );
}
