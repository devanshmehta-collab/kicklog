"use client";

import { ArrowRight, Plus } from "lucide-react";
import * as React from "react";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, Empty, Field, Input, Money, Select, Textarea } from "@/components/ui/primitives";
import { ApiError, apiFetch, newKey, useGet, useSend } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import { SOURCING_FLOW } from "@/lib/sourcing-flow";
import type { listRequests } from "@/lib/services/sourcing";
import type { listSales } from "@/lib/services/sales";
import { useQueryClient } from "@tanstack/react-query";

type Req = Awaited<ReturnType<typeof listRequests>>[number];
type Sale = Awaited<ReturnType<typeof listSales>>[number];
const NEXT: Record<string, string> = Object.fromEntries(SOURCING_FLOW.slice(0, -1).map((s, i) => [s, SOURCING_FLOW[i + 1]]));
const paiseOrUndef = (v: string) => (v ? rupeesToPaise(Number(v)) : undefined);

export default function SourcingPage() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const reqs = useGet<Req[]>(["sourcing"], "/api/sourcing");
  const [create, setCreate] = React.useState(false);
  const [buy, setBuy] = React.useState<Req | null>(null);
  const [link, setLink] = React.useState<Req | null>(null);
  const [edit, setEdit] = React.useState<Req | null>(null);
  const [err, setErr] = React.useState("");
  const qc = useQueryClient();

  async function advance(r: Req) {
    setErr("");
    const to = NEXT[r.status];
    try {
      if (to === "purchased") return setBuy(r);
      if (to === "completed" && !r.saleId) return setLink(r);
      await apiFetch(`/api/sourcing/${r.id}/status`, { method: "POST", json: { status: to } });
      await qc.invalidateQueries();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    }
  }
  async function cancel(r: Req) {
    await apiFetch(`/api/sourcing/${r.id}/status`, { method: "POST", json: { status: "cancelled" } });
    await qc.invalidateQueries();
  }

  const groups = [...SOURCING_FLOW, "cancelled"] as const;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sourcing requests</h1>
          <p className="text-sm text-muted">Products customers want that you don&apos;t own yet. These stay out of inventory until you record a real purchase.</p>
        </div>
        {write && <Button onClick={() => setCreate(true)}><Plus size={16} /> New request</Button>}
      </div>
      {err && <p role="alert" className="text-sm text-loss">{err}</p>}
      {reqs.data?.length === 0 && <Card><Empty>No sourcing requests yet.</Empty></Card>}
      <div className="space-y-6">
        {groups.map((g) => {
          const items = (reqs.data ?? []).filter((r) => r.status === g);
          if (!items.length) return null;
          return (
            <section key={g}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium tracking-wide text-muted uppercase">{g} <Badge>{items.length}</Badge></h2>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {items.map((r) => (
                  <Card key={r.id} className="p-4">
                    <div className="font-medium">{r.product}</div>
                    <div className="mt-0.5 text-xs text-muted">{[r.customerName, r.desiredSize && `size ${r.desiredSize}`, r.supplierName && `via ${r.supplierName}`].filter(Boolean).join(" · ")}</div>
                    <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div><dt className="text-muted">Budget</dt><dd><Money paise={r.budgetPaise} /></dd></div>
                      <div><dt className="text-muted">Quote</dt><dd><Money paise={r.quotedPricePaise} /></dd></div>
                      <div><dt className="text-muted">Est. cost</dt><dd><Money paise={r.estimatedCostPaise} /></dd></div>
                    </dl>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {r.depositPaise > 0 && <Badge tone={r.depositReceived ? "gain" : "review"}>Deposit <Money paise={r.depositPaise} /> {r.depositReceived ? "received" : "pending"}</Badge>}
                      {r.deliveryStatus && <Badge>{r.deliveryStatus}</Badge>}
                      {r.saleId && <Badge tone="gain">sale linked</Badge>}
                    </div>
                    {write && g !== "completed" && g !== "cancelled" && (
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => advance(r)}>{NEXT[g]} <ArrowRight size={13} /></Button>
                        <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => cancel(r)}>Cancel</Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <RequestDialog open={create || !!edit} existing={edit} onClose={() => { setCreate(false); setEdit(null); }} />
      <PurchaseDialog req={buy} onClose={() => setBuy(null)} />
      <LinkSaleDialog req={link} onClose={() => setLink(null)} />
    </div>
  );
}

function RequestDialog({ open, existing, onClose }: { open: boolean; existing: Req | null; onClose: () => void }) {
  const customers = useGet<{ id: string; name: string }[]>(["customers", ""], open ? "/api/customers" : null);
  const suppliers = useGet<{ id: string; name: string }[]>(["suppliers"], open ? "/api/suppliers" : null);
  const [f, setF] = React.useState({ product: "", customerId: "", supplierId: "", size: "", budget: "", quote: "", cost: "", deposit: "", depositReceived: false, delivery: "", notes: "", newSupplier: "" });
  const [error, setError] = React.useState("");
  const send = useSend<Record<string, unknown>, unknown>(existing ? "PATCH" : "POST", existing ? `/api/sourcing/${existing.id}` : "/api/sourcing");
  React.useEffect(() => {
    if (!open) return;
    const r = existing;
    const rs = (n: number | null | undefined) => (n != null ? String(n / 100) : "");
    setF({ product: r?.product ?? "", customerId: r?.customerId ?? "", supplierId: r?.supplierId ?? "", size: r?.desiredSize ?? "", budget: rs(r?.budgetPaise), quote: rs(r?.quotedPricePaise), cost: rs(r?.estimatedCostPaise), deposit: r?.depositPaise ? rs(r.depositPaise) : "", depositReceived: r?.depositReceived ?? false, delivery: r?.deliveryStatus ?? "", notes: r?.notes ?? "", newSupplier: "" });
    setError("");
  }, [open, existing]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    try {
      let supplierId = f.supplierId || null;
      if (f.newSupplier.trim()) supplierId = (await apiFetch<{ id: string }>("/api/suppliers", { method: "POST", json: { name: f.newSupplier.trim() } })).id;
      await send.mutateAsync({
        product: f.product, customerId: f.customerId || null, supplierId, desiredSize: f.size || null,
        budgetPaise: paiseOrUndef(f.budget) ?? null, quotedPricePaise: paiseOrUndef(f.quote) ?? null, estimatedCostPaise: paiseOrUndef(f.cost) ?? null,
        depositPaise: paiseOrUndef(f.deposit) ?? 0, depositReceived: f.depositReceived, deliveryStatus: f.delivery || null, notes: f.notes || null,
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  return (
    <Dialog open={open} onClose={onClose} title={existing ? "Edit request" : "New sourcing request"} wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Requested product" className="sm:col-span-2"><Input value={f.product} onChange={set("product")} placeholder="Jordan 4 Military Black" /></Field>
        <Field label="Customer"><Select value={f.customerId} onChange={set("customerId")}><option value="">—</option>{customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        <Field label="Desired size"><Input value={f.size} onChange={set("size")} /></Field>
        <Field label="Customer budget ₹"><Input inputMode="decimal" value={f.budget} onChange={set("budget")} /></Field>
        <Field label="Quoted selling price ₹"><Input inputMode="decimal" value={f.quote} onChange={set("quote")} /></Field>
        <Field label="Estimated sourcing cost ₹"><Input inputMode="decimal" value={f.cost} onChange={set("cost")} /></Field>
        <Field label="Supplier"><Select value={f.supplierId} onChange={set("supplierId")}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="…or add new supplier"><Input value={f.newSupplier} onChange={set("newSupplier")} /></Field>
        <Field label="Deposit ₹"><Input inputMode="decimal" value={f.deposit} onChange={set("deposit")} /></Field>
        <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" checked={f.depositReceived} onChange={(e) => setF({ ...f, depositReceived: e.target.checked })} /> Deposit received</label>
        <Field label="Delivery status"><Input value={f.delivery} onChange={set("delivery")} placeholder="In transit, at customs…" /></Field>
        <Field label="Notes"><Textarea rows={1} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={f.product.trim().length < 2 || send.isPending}>Save</Button></div>
    </Dialog>
  );
}

function PurchaseDialog({ req, onClose }: { req: Req | null; onClose: () => void }) {
  const [f, setF] = React.useState({ size: "", qty: "1", cost: "", intl: false, currency: "USD", price: "", fx: "", country: "", ship: "", duty: "", fees: "", dom: "" });
  const [error, setError] = React.useState("");
  const keyRef = React.useRef(newKey());
  const qc = useQueryClient();
  React.useEffect(() => {
    if (req) setF((x) => ({ ...x, size: req.desiredSize ?? "", cost: req.estimatedCostPaise ? String(req.estimatedCostPaise / 100) : "" }));
  }, [req]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setError("");
    try {
      const lot: Record<string, unknown> = { size: f.size || "OS", quantity: Number(f.qty), supplierId: req?.supplierId ?? null };
      if (f.intl) lot.landed = { foreignCurrency: f.currency, foreignUnitPriceMinor: Math.round(Number(f.price) * 100), fxRate: Number(f.fx), countryOfOrigin: f.country || null, internationalShippingPaise: paiseOrUndef(f.ship), customsDutyPaise: paiseOrUndef(f.duty), paymentFeesPaise: paiseOrUndef(f.fees), domesticShippingPaise: paiseOrUndef(f.dom) };
      else lot.unitCostPaise = rupeesToPaise(Number(f.cost));
      await apiFetch(`/api/sourcing/${req!.id}/purchase`, { method: "POST", json: { lot, idempotencyKey: keyRef.current } });
      keyRef.current = newKey();
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not record purchase");
    }
  }
  return (
    <Dialog open={!!req} onClose={onClose} title={`Record purchase — ${req?.product ?? ""}`}>
      <p className="mb-3 text-sm text-muted">This is the moment the item becomes owned stock. Only a confirmed request can be purchased.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Size"><Input value={f.size} onChange={set("size")} /></Field>
        <Field label="Quantity"><Input value={f.qty} onChange={set("qty")} inputMode="numeric" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.intl} onChange={(e) => setF({ ...f, intl: e.target.checked })} /> International (landed cost)</label>
        {!f.intl ? (
          <Field label="Unit cost ₹ (all-in)" className="sm:col-span-2"><Input value={f.cost} onChange={set("cost")} inputMode="decimal" /></Field>
        ) : (
          <>
            <Field label="Currency"><Input value={f.currency} onChange={set("currency")} /></Field>
            <Field label="Supplier price / unit"><Input value={f.price} onChange={set("price")} inputMode="decimal" /></Field>
            <Field label="FX rate (₹ per 1)"><Input value={f.fx} onChange={set("fx")} inputMode="decimal" /></Field>
            <Field label="Country of origin"><Input value={f.country} onChange={set("country")} /></Field>
            <Field label="Intl shipping ₹ (total)"><Input value={f.ship} onChange={set("ship")} inputMode="decimal" /></Field>
            <Field label="Customs duty ₹ (total)"><Input value={f.duty} onChange={set("duty")} inputMode="decimal" /></Field>
            <Field label="Payment fees ₹ (total)"><Input value={f.fees} onChange={set("fees")} inputMode="decimal" /></Field>
            <Field label="Domestic shipping ₹ (total)"><Input value={f.dom} onChange={set("dom")} inputMode="decimal" /></Field>
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Add to inventory</Button></div>
    </Dialog>
  );
}

function LinkSaleDialog({ req, onClose }: { req: Req | null; onClose: () => void }) {
  const sales = useGet<Sale[]>(["sales"], req ? "/api/sales" : null);
  const [saleId, setSaleId] = React.useState("");
  const [error, setError] = React.useState("");
  const qc = useQueryClient();
  async function save() {
    try {
      await apiFetch(`/api/sourcing/${req!.id}/link-sale`, { method: "POST", json: { saleId } });
      await apiFetch(`/api/sourcing/${req!.id}/status`, { method: "POST", json: { status: "completed" } });
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }
  return (
    <Dialog open={!!req} onClose={onClose} title="Link the final sale">
      <p className="mb-3 text-sm text-muted">Record the sale first (Overview or Sales), then pick it here to complete the request.</p>
      <Select value={saleId} onChange={(e) => setSaleId(e.target.value)}>
        <option value="">Choose a sale…</option>
        {sales.data?.map((s) => <option key={s.id} value={s.id}>{new Date(s.saleDate).toLocaleDateString("en-IN")} · {s.items.map((i) => i.name).join(", ")} · {s.customerName ?? "walk-in"}</option>)}
      </Select>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!saleId}>Complete request</Button></div>
    </Dialog>
  );
}
