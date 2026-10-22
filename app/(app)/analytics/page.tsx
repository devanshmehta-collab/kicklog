"use client";

import * as React from "react";
import { Bars, Donut, TrendChart } from "@/components/charts";
import { Badge, Card, CardHeader, Empty, Input, Money, Select, Table, Td, Th } from "@/components/ui/primitives";
import { useGet } from "@/lib/client/api";
import type { summary } from "@/lib/services/analytics";

type Summary = Awaited<ReturnType<typeof summary>>;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function range(preset: string): { from?: string; to?: string } {
  const now = new Date();
  const to = iso(now);
  const back = (days: number) => iso(new Date(now.getTime() - days * 86400_000));
  if (preset === "30") return { from: back(30), to };
  if (preset === "90") return { from: back(90), to };
  if (preset === "ytd") return { from: `${now.getFullYear()}-01-01`, to };
  return {};
}

function Stat({ label, paise, text, tone }: { label: string; paise?: number; text?: string; tone?: "gain" }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${tone === "gain" ? "text-gain" : ""}`}>{paise != null ? <Money paise={paise} /> : <span className="num">{text}</span>}</div>
    </Card>
  );
}

export default function AnalyticsPage() {
  const [preset, setPreset] = React.useState("all");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const r = preset === "custom" ? { from, to } : range(preset);
  const qs = new URLSearchParams(Object.entries(r).filter(([, v]) => v) as [string, string][]).toString();
  const { data } = useGet<Summary>(["analytics", qs], `/api/analytics${qs ? `?${qs}` : ""}`);
  const k = data?.kpis;
  const rep = data?.repeatCustomers;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted">Realised numbers only, net of refunds. Resale value is projected and kept separate.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={preset} onChange={(e) => setPreset(e.target.value)} className="w-40" aria-label="Date range">
            <option value="all">All time</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="ytd">This year</option><option value="custom">Custom…</option>
          </Select>
          {preset === "custom" && (<><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="From" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="To" /></>)}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Realised revenue" paise={k?.realizedRevenuePaise} />
        <Stat label="Cost of goods sold" paise={k?.cogsPaise} />
        <Stat label="Gross profit" paise={k?.realizedGrossProfitPaise} />
        <Stat label="Net profit" paise={k?.realizedNetProfitPaise} tone="gain" />
        <Stat label="Gross margin" text={k ? `${k.grossMarginPct.toFixed(1)}%` : "—"} />
        <Stat label="Net margin" text={k ? `${k.netMarginPct.toFixed(1)}%` : "—"} />
        <Stat label="Selling expenses" paise={k?.sellingExpensesPaise} />
        <Stat label="Refunded" paise={k?.refundedPaise} />
        <Stat label="Units sold" text={String(k?.unitsSold ?? "—")} />
        <Stat label="Units in stock" text={String(k?.unitsInStock ?? "—")} />
        <Stat label="Inventory at cost" paise={k?.inventoryCostValuePaise} />
        <Stat label="Potential resale value" paise={k?.potentialResaleValuePaise} />
        <Stat label="Capital invested (all-time)" paise={k?.capitalInvestedPaise} />
        <Stat label="Partner share of profit" paise={k?.partnerProfitSharePaise} />
        <Stat label="Orders" text={String(k?.orders ?? "—")} />
        <Stat label="Repeat customers" text={rep ? `${rep.repeat} of ${rep.repeat + rep.oneTime}` : "—"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2"><CardHeader title="Revenue vs profit" /><div className="px-3 pb-4"><TrendChart data={data?.trend ?? []} /></div></Card>
        <Card><CardHeader title="Sales by category" /><div className="px-3 pb-4"><Donut data={data?.byCategory ?? []} /></div></Card>
        <Card><CardHeader title="Sales by brand" /><div className="px-3 pb-4"><Bars data={data?.byBrand ?? []} x="name" y="revenue" name="Revenue" /></div></Card>
        <Card><CardHeader title="Monthly purchase spending" /><div className="px-3 pb-4"><Bars data={data?.purchaseSpend ?? []} x="month" y="spend" name="Spend" color="#d4b36a" /></div></Card>
        <Card><CardHeader title="Inventory composition (at cost)" /><div className="px-3 pb-4"><Donut data={data?.composition ?? []} valueKey="value" /></div></Card>
        <Card><CardHeader title="B2B vs D2C revenue" /><div className="px-3 pb-4"><Donut data={data?.byCustomerType ?? []} /></div></Card>
        <Card>
          <CardHeader title="Customer repeat purchases" />
          <div className="px-3 pb-4"><Bars money={false} x="name" y="customers" name="Customers" color="#5ed68c" data={rep ? [{ name: "One-time", customers: rep.oneTime }, { name: "Repeat", customers: rep.repeat }] : []} /></div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Slow-moving inventory" />
          <Table><thead><tr><Th>Item</Th><Th className="text-right">Qty</Th><Th className="text-right">Days held</Th><Th className="text-right">Tied-up cost</Th></tr></thead>
            <tbody>{data?.slowMoving.map((s) => <tr key={s.variantId}><Td>{s.name} <span className="text-muted">· {s.size}</span></Td><Td className="text-right num">{s.quantity}</Td><Td className="text-right num">{s.days}</Td><Td className="text-right"><Money paise={s.costValuePaise} /></Td></tr>)}</tbody></Table>
          {data?.slowMoving.length === 0 && <Empty>Nothing is sitting too long. 🎯</Empty>}
        </Card>
        <Card>
          <CardHeader title="Low-stock warnings" />
          <ul className="divide-y divide-line">{data?.lowStock.map((s) => <li key={s.variantId} className="flex items-center justify-between px-5 py-3 text-sm"><span>{s.name} <span className="text-muted">· size {s.size}</span></span><Badge tone={s.quantity === 0 ? "loss" : "review"}>{s.quantity} left</Badge></li>)}</ul>
          {data?.lowStock.length === 0 && <Empty>No best-sellers running low.</Empty>}
        </Card>
      </div>
    </div>
  );
}
