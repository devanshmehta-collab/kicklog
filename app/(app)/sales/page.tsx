"use client";

import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { RefundDialog, type SaleLike } from "@/components/refund-dialog";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, Empty, Field, Input, Money, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { ApiError, newKey, useGet, useSend } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import type { listCustomers } from "@/lib/services/customers";
import type { StockRow } from "@/lib/services/inventory";
import type { listSales } from "@/lib/services/sales";

type Sale = Awaited<ReturnType<typeof listSales>>[number];
const CHANNELS = ["whatsapp", "instagram", "in person", "b2b", "marketplace", "other"];

export default function SalesPage() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const sales = useGet<Sale[]>(["sales"], "/api/sales");
  const [open, setOpen] = React.useState(false);
  const [refund, setRefund] = React.useState<SaleLike | null>(null);
  const total = (sales.data ?? []).reduce((a, s) => a + s.netProfitPaise, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sales</h1>
          <p className="text-sm text-muted">Net realised profit across listed sales: <Money paise={total} signed /></p>
        </div>
        {write && <Button onClick={() => setOpen(true)}><Plus size={16} /> Record sale</Button>}
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Date</Th><Th>Items</Th><Th>Customer</Th><Th>Channel</Th><Th className="text-right">Revenue</Th><Th className="text-right">Cost</Th><Th className="text-right">Profit</Th><Th /></tr></thead>
          <tbody>
            {sales.data?.map((s) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap text-muted">{new Date(s.saleDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" })}</Td>
                <Td>
                  {s.items.map((i) => (
                    <div key={i.id}>{i.name} <span className="text-muted">· {i.size} × {i.quantity}</span>{i.refundedQuantity > 0 && <Badge tone="loss" className="ml-2">{i.refundedQuantity} refunded</Badge>}</div>
                  ))}
                  <div className="text-xs text-muted">{s.source === "ai" ? "via Quick Log" : "manual"}</div>
                </Td>
                <Td>{s.customerName ?? <span className="text-muted">—</span>}</Td>
                <Td className="capitalize text-muted">{s.channel}</Td>
                <Td className="text-right"><Money paise={s.netProceedsPaise - s.refundedPaise} /></Td>
                <Td className="text-right"><Money paise={s.cogsPaise} /></Td>
                <Td className="text-right"><Money paise={s.netProfitPaise} signed /></Td>
                <Td className="text-right">{write && s.status !== "refunded" && <Button size="sm" variant="ghost" onClick={() => setRefund(s)}>Refund</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {sales.data?.length === 0 && <Empty>No sales recorded yet.</Empty>}
      </Card>
      <SaleDialog open={open} onClose={() => setOpen(false)} />
      <RefundDialog sale={refund} onClose={() => setRefund(null)} />
    </div>
  );
}

function SaleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const stock = useGet<StockRow[]>(["stock"], open ? "/api/inventory/stock" : null);
  const customers = useGet<Awaited<ReturnType<typeof listCustomers>>>(["customers"], open ? "/api/customers" : null);
  const [lines, setLines] = React.useState([{ variantId: "", quantity: "1", price: "" }]);
  const [f, setF] = React.useState({ customer: "", phone: "", channel: "whatsapp", discount: "", shipRev: "", shipCost: "", fees: "", other: "", notes: "", date: "" });
  const [error, setError] = React.useState("");
  const keyRef = React.useRef(newKey());
  const send = useSend<Record<string, unknown>, { saleId: string; profitPaise: number }>("POST", "/api/sales");
  const [done, setDone] = React.useState<number | null>(null);
  const p = (v: string) => (v ? rupeesToPaise(Number(v)) : 0);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const known = customers.data?.find((c) => c.name.toLowerCase() === f.customer.trim().toLowerCase() || (f.phone && c.phone === f.phone));

  async function save() {
    setError("");
    try {
      const r = await send.mutateAsync({
        idempotencyKey: keyRef.current,
        lines: lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitPricePaise: p(l.price) })),
        customer: known ? { id: known.id } : f.customer.trim() ? { name: f.customer.trim(), phone: f.phone || null } : null,
        channel: f.channel,
        saleDate: f.date ? new Date(f.date).toISOString() : undefined,
        costs: { discountPaise: p(f.discount), shippingRevenuePaise: p(f.shipRev), shippingCostPaise: p(f.shipCost), feesPaise: p(f.fees), otherExpensesPaise: p(f.other) },
        notes: f.notes || null,
      });
      setDone(r.profitPaise);
      keyRef.current = newKey();
      setLines([{ variantId: "", quantity: "1", price: "" }]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save sale");
    }
  }

  return (
    <Dialog open={open} onClose={() => { setDone(null); onClose(); }} title="Record sale" wide>
      {done != null ? (
        <div className="space-y-4 text-center">
          <p className="text-lg">Sale recorded — profit <Money paise={done} signed /></p>
          <Button onClick={() => { setDone(null); onClose(); }}>Done</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_64px_110px_36px] items-end gap-2">
                <Field label={i === 0 ? "Item" : ""}>
                  <Select value={l.variantId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, variantId: e.target.value } : x)))}>
                    <option value="">Select in-stock item…</option>
                    {stock.data?.map((s) => <option key={s.variantId} value={s.variantId}>{s.name} · size {s.size} ({s.quantity})</option>)}
                  </Select>
                </Field>
                <Field label={i === 0 ? "Qty" : ""}><Input inputMode="numeric" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} /></Field>
                <Field label={i === 0 ? "Price/unit ₹" : ""}><Input inputMode="decimal" value={l.price} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} /></Field>
                <Button variant="ghost" size="icon" aria-label="Remove line" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 size={15} /></Button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { variantId: "", quantity: "1", price: "" }])}><Plus size={14} /> Add item</Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer" hint={known ? `Existing customer · ${known.orders} orders` : f.customer ? "New customer will be created" : undefined}>
              <Input list="cust-list" value={f.customer} onChange={set("customer")} placeholder="Name" />
              <datalist id="cust-list">{customers.data?.map((c) => <option key={c.id} value={c.name} />)}</datalist>
            </Field>
            <Field label="Phone (for new customer)"><Input value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Channel"><Select value={f.channel} onChange={set("channel")}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Date"><Input type="date" value={f.date} onChange={set("date")} /></Field>
            <Field label="Discount ₹"><Input inputMode="decimal" value={f.discount} onChange={set("discount")} /></Field>
            <Field label="Shipping charged to buyer ₹"><Input inputMode="decimal" value={f.shipRev} onChange={set("shipRev")} /></Field>
            <Field label="Shipping you paid ₹"><Input inputMode="decimal" value={f.shipCost} onChange={set("shipCost")} /></Field>
            <Field label="Platform / payment fees ₹"><Input inputMode="decimal" value={f.fees} onChange={set("fees")} /></Field>
            <Field label="Other selling expenses ₹"><Input inputMode="decimal" value={f.other} onChange={set("other")} /></Field>
            <Field label="Private notes"><Textarea rows={1} value={f.notes} onChange={set("notes")} /></Field>
          </div>
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={send.isPending || lines.some((l) => !l.variantId || !l.price)}>Record sale</Button></div>
        </div>
      )}
    </Dialog>
  );
}
