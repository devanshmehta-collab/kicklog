"use client";

import { Archive, Layers, PackagePlus, Pencil, Plus, Search } from "lucide-react";
import * as React from "react";
import { AddProductDialog, EditProductDialog, RestockDialog, type ProductLite } from "@/components/product-forms";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, Empty, Field, Input, Money, Select, Table, Td, Th } from "@/components/ui/primitives";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, apiFetch, useGet, useSend } from "@/lib/client/api";
import type { getProductDetail } from "@/lib/services/inventory";
import type { listMovements } from "@/lib/services/inventory";

interface Row extends ProductLite {
  units: number;
  sizes: string[];
  imageUrl: string | null;
}

export default function InventoryPage() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [add, setAdd] = React.useState(false);
  const [edit, setEdit] = React.useState<Row | null>(null);
  const [restock, setRestock] = React.useState<Row | null>(null);
  const [lots, setLots] = React.useState<Row | null>(null);
  const products = useGet<Row[]>(["products"], "/api/products");
  const qc = useQueryClient();
  const [err, setErr] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busyId, setBusyId] = React.useState("");

  const rows = (products.data ?? []).filter(
    (p) =>
      (!q || [p.name, p.brand, p.sku, p.colorway].some((x) => x?.toLowerCase().includes(q.toLowerCase()))) &&
      (!status || p.status === status) &&
      (!category || p.category === category),
  );

  async function setStatusFor(p: Row, s: string) {
    setErr("");
    setNotice("");
    setBusyId(p.id);
    try {
      await apiFetch(`/api/products/${p.id}`, { method: "PATCH", json: { status: s } });
      await qc.invalidateQueries();
      if (s === "published") {
        setNotice(
          p.units > 0
            ? `"${p.name}" is now live on your website.`
            : `"${p.name}" is published, but customers won't see it until it has stock. Use Restock to add units.`,
        );
      } else if (s === "draft") setNotice(`"${p.name}" is hidden from your website.`);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Failed";
      if (/public price/i.test(msg)) {
        // the one thing blocking publishing is the price: take them straight to where it is set
        setEdit(p);
        setNotice(`Add a public price for "${p.name}", save, then press Publish.`);
      } else setErr(msg);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        {write && <Button onClick={() => setAdd(true)}><Plus size={16} /> Add product</Button>}
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_160px_160px]">
        <div className="relative">
          <Search size={15} className="absolute top-3 left-3 text-muted" />
          <Input className="pl-9" placeholder="Search name, brand, SKU, colorway" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {["sneakers", "apparel", "watches", "bags", "accessories", "other"].map((c) => <option key={c}>{c}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option>
        </Select>
      </div>
      {err && <p role="alert" className="text-sm text-loss">{err}</p>}
      {notice && <p role="status" className="rounded-lg border border-gain/30 bg-gain/10 px-3 py-2 text-sm">{notice}</p>}
      <Card>
        <Table>
          <thead><tr><Th>Product</Th><Th>Sizes in stock</Th><Th className="text-right">Units</Th><Th className="text-right">Public price</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td>
                  <div className="flex items-center gap-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-11 w-11 rounded-lg border border-line object-cover" />
                    ) : (
                      <div className="h-11 w-11 rounded-lg border border-line bg-raised" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-muted">{[p.brand, p.category, p.sku].filter(Boolean).join(" · ")}</div>
                    </div>
                  </div>
                </Td>
                <Td className="max-w-[200px] text-muted">{p.sizes.join(", ") || "—"}</Td>
                <Td className="text-right num">{p.units}</Td>
                <Td className="text-right"><Money paise={p.publicPricePaise} /></Td>
                <Td>
                  <div className="flex flex-col items-start gap-1.5">
                    <Badge tone={p.status === "published" ? "gain" : "neutral"}>{p.status}</Badge>
                    {write && p.status === "draft" && (
                      <Button size="sm" onClick={() => setStatusFor(p, "published")} disabled={busyId === p.id}>{busyId === p.id ? "Publishing…" : "Publish"}</Button>
                    )}
                    {write && p.status === "published" && (
                      <Button size="sm" variant="secondary" onClick={() => setStatusFor(p, "draft")} disabled={busyId === p.id}>{busyId === p.id ? "Updating…" : "Unpublish"}</Button>
                    )}
                    {write && p.status === "archived" && (
                      <Button size="sm" variant="secondary" onClick={() => setStatusFor(p, "draft")} disabled={busyId === p.id}>Restore</Button>
                    )}
                  </div>
                </Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" aria-label="Lots and stock" title="Lots & stock" onClick={() => setLots(p)}><Layers size={16} /></Button>
                    {write && (
                      <>
                        <Button variant="ghost" size="icon" aria-label="Restock" title="Restock" onClick={() => setRestock(p)}><PackagePlus size={16} /></Button>
                        <Button variant="ghost" size="icon" aria-label="Edit" title="Edit" onClick={() => setEdit(p)}><Pencil size={16} /></Button>
                        {p.status !== "archived" && <Button variant="ghost" size="icon" aria-label="Archive" title="Archive" onClick={() => setStatusFor(p, "archived")}><Archive size={16} /></Button>}
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <Empty>{products.isLoading ? "Loading…" : "No products match. Add one, or log a purchase from the Overview."}</Empty>}
      </Card>

      <MovementsCard />
      <AddProductDialog open={add} onClose={() => setAdd(false)} />
      <EditProductDialog product={edit} onClose={() => setEdit(null)} />
      <RestockDialog product={restock} onClose={() => setRestock(null)} />
      <LotsDialog product={lots} onClose={() => setLots(null)} write={write} />
    </div>
  );
}

function MovementsCard() {
  const m = useGet<Awaited<ReturnType<typeof listMovements>>>(["movements"], "/api/inventory/movements");
  const [open, setOpen] = React.useState(false);
  return (
    <Card>
      <button className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium tracking-wide text-muted uppercase" onClick={() => setOpen((o) => !o)}>
        Stock movement ledger <span>{open ? "−" : "+"}</span>
      </button>
      {open && (
        <Table>
          <thead><tr><Th>When</Th><Th>Item</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th>Note</Th></tr></thead>
          <tbody>
            {m.data?.map((x) => (
              <tr key={x.id}>
                <Td className="whitespace-nowrap text-muted">{new Date(x.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</Td>
                <Td>{x.productName} · {x.size}</Td>
                <Td><Badge>{x.type.replace("_", " ")}</Badge></Td>
                <Td className={`text-right num ${x.quantity < 0 ? "text-loss" : "text-gain"}`}>{x.quantity > 0 ? "+" : ""}{x.quantity}</Td>
                <Td className="max-w-[260px] truncate text-muted">{x.note}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function LotsDialog({ product, onClose, write }: { product: Row | null; onClose: () => void; write: boolean }) {
  const detail = useGet<Awaited<ReturnType<typeof getProductDetail>>>(["product", product?.id], product ? `/api/products/${product.id}` : null);
  const adjust = useSend<{ lotId: string; delta: number; reason: string }, unknown>("POST", "/api/inventory/adjust");
  const [lot, setLot] = React.useState("");
  const [delta, setDelta] = React.useState("-1");
  const [reason, setReason] = React.useState("");
  const [err, setErr] = React.useState("");
  const partners = useGet<{ ledger?: { partnerId: string | null; name: string }[] }>(["partners"], product && write ? "/api/partners" : null);
  const [own, setOwn] = React.useState({ lot: "", partnerId: "", cap: "50", profit: "50" });
  const [ownMsg, setOwnMsg] = React.useState("");
  const qc = useQueryClient();
  async function assign() {
    setOwnMsg("");
    try {
      await apiFetch(`/api/lots/${own.lot}/ownership`, {
        method: "PUT",
        json: { shares: own.partnerId ? [{ partnerId: own.partnerId, ownershipBps: Math.round(Number(own.cap) * 100), profitShareBps: Math.round(Number(own.profit) * 100) }] : [] },
      });
      await qc.invalidateQueries();
      setOwnMsg("Saved. Applies to future sales of this lot.");
    } catch (e) {
      setOwnMsg(e instanceof ApiError ? e.message : "Failed");
    }
  }
  const sizeOf = (variantId: string) => detail.data?.variants.find((v) => v.id === variantId)?.size ?? "";

  async function submit() {
    setErr("");
    try {
      await adjust.mutateAsync({ lotId: lot, delta: Number(delta), reason });
      setReason("");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Failed");
    }
  }
  return (
    <Dialog open={!!product} onClose={onClose} title={`${product?.name ?? ""} — lots`} wide>
      <Table>
        <thead><tr><Th>Size</Th><Th>Acquired</Th><Th className="text-right">Left</Th><Th className="text-right">Unit cost</Th><Th>Source</Th></tr></thead>
        <tbody>
          {detail.data?.lots.map((l) => (
            <tr key={l.id}>
              <Td>{sizeOf(l.variantId)}</Td>
              <Td className="text-muted">{new Date(l.purchaseDate).toLocaleDateString("en-IN")} · {l.quantityAcquired}</Td>
              <Td className="text-right num">{l.quantityRemaining}</Td>
              <Td className="text-right"><Money paise={l.unitCostPaise} /></Td>
              <Td className="text-muted">{l.source}{l.countryOfOrigin ? ` · ${l.countryOfOrigin}` : ""}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {write && (
        <div className="mt-5 rounded-xl border border-line p-4">
          <div className="mb-3 text-sm font-medium">Adjust stock</div>
          <div className="grid gap-2 sm:grid-cols-[1.4fr_90px_1.6fr_auto]">
            <Field label="Lot"><Select value={lot} onChange={(e) => setLot(e.target.value)}><option value="">Select lot…</option>{detail.data?.lots.map((l) => <option key={l.id} value={l.id}>size {sizeOf(l.variantId)} · {l.quantityRemaining} left</option>)}</Select></Field>
            <Field label="± units"><Input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="numeric" /></Field>
            <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recount, damaged, gift…" /></Field>
            <div className="flex items-end"><Button onClick={submit} disabled={!lot || !reason || adjust.isPending}>Apply</Button></div>
          </div>
          {err && <p role="alert" className="mt-2 text-sm text-loss">{err}</p>}
          <p className="mt-2 text-xs text-muted">Every adjustment is written to the stock ledger and audit log. Stock can never go below zero.</p>
        </div>
      )}
      {write && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <div className="mb-3 text-sm font-medium">Partner co-investment on a lot</div>
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1.2fr_90px_90px_auto]">
            <Field label="Lot"><Select value={own.lot} onChange={(e) => setOwn({ ...own, lot: e.target.value })}><option value="">Select lot…</option>{detail.data?.lots.map((l) => <option key={l.id} value={l.id}>size {sizeOf(l.variantId)} · {l.quantityRemaining} left</option>)}</Select></Field>
            <Field label="Partner"><Select value={own.partnerId} onChange={(e) => setOwn({ ...own, partnerId: e.target.value })}><option value="">None (100% mine)</option>{partners.data?.ledger?.filter((x) => x.partnerId).map((x) => <option key={x.partnerId!} value={x.partnerId!}>{x.name}</option>)}</Select></Field>
            <Field label="Capital %"><Input value={own.cap} onChange={(e) => setOwn({ ...own, cap: e.target.value })} inputMode="decimal" /></Field>
            <Field label="Profit %"><Input value={own.profit} onChange={(e) => setOwn({ ...own, profit: e.target.value })} inputMode="decimal" /></Field>
            <div className="flex items-end"><Button variant="secondary" onClick={assign} disabled={!own.lot}>Save</Button></div>
          </div>
          {ownMsg && <p className="mt-2 text-xs text-muted">{ownMsg}</p>}
        </div>
      )}
    </Dialog>
  );
}
