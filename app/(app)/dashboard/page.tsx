"use client";

import { Boxes, IndianRupee, PackageCheck, TrendingUp, type LucideIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Bars, Donut, TrendChart } from "@/components/charts";
import { InvoiceButton } from "@/components/invoice-button";
import { QuickLog } from "@/components/quick-log";
import { RefundDialog, type SaleLike } from "@/components/refund-dialog";
import { ReviewCards } from "@/components/review-cards";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, Empty, Money, Table, Tabs, Td, Th } from "@/components/ui/primitives";
import { useGet } from "@/lib/client/api";
import type { summary, recentActivity } from "@/lib/services/analytics";
import type { StockRow } from "@/lib/services/inventory";
import type { listSales } from "@/lib/services/sales";

type Summary = Awaited<ReturnType<typeof summary>>;
type Sale = Awaited<ReturnType<typeof listSales>>[number];

function Kpi({ label, paise, value, tone, hint, icon: Icon, lead }: { label: string; paise?: number; value?: string | number; tone?: "gain"; hint?: string; icon: LucideIcon; lead?: boolean }) {
  return (
    <Card data-kpi={label} className={`relative overflow-hidden px-5 py-4 ${lead ? "border-gain/25 bg-gain/[0.04]" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="min-w-0 pr-2 text-[11px] font-medium tracking-[0.16em] text-muted uppercase">{label}</div>
        <Icon size={15} className={`shrink-0 ${lead ? "text-gain" : "text-muted/60"}`} aria-hidden />
      </div>
      <div className={`mt-3 text-[1.7rem] leading-none font-semibold tracking-tight sm:text-4xl ${tone === "gain" ? "text-gain" : ""}`}>
        {paise != null ? <Money paise={paise} /> : <span className="num">{value ?? "—"}</span>}
      </div>
      {hint && <div className="mt-2 text-xs text-muted">{hint}</div>}
    </Card>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Overview() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const sum = useGet<Summary>(["analytics", "all"], "/api/analytics");
  const stock = useGet<StockRow[]>(["stock"], "/api/inventory/stock");
  const sales = useGet<Sale[]>(["sales"], "/api/sales");
  const activity = useGet<Awaited<ReturnType<typeof recentActivity>>>(["activity"], "/api/activity");
  const [tab, setTab] = React.useState<"stock" | "sold">("stock");
  const [refund, setRefund] = React.useState<SaleLike | null>(null);
  const k = sum.data?.kpis;
  const sold = sales.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting()}{user ? `, ${user.name.split(" ")[0]}` : ""}</h1>
          <p className="mt-0.5 text-sm text-muted">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} · here is where the business stands.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi lead icon={TrendingUp} label="Realized profit" paise={k?.realizedNetProfitPaise} tone="gain" hint={k ? `${k.netMarginPct.toFixed(1)}% net margin` : undefined} />
        <Kpi icon={Boxes} label="Inventory cost value" paise={k?.inventoryCostValuePaise} hint="At acquisition cost" />
        <Kpi icon={IndianRupee} label="Realized revenue" paise={k?.realizedRevenuePaise} hint={k ? `${k.orders} orders · net of refunds` : undefined} />
        <Kpi icon={PackageCheck} label="In-stock units" value={k?.unitsInStock} hint={k ? `${k.unitsSold} sold` : undefined} />
      </div>

      <QuickLog canWrite={write} />
      <ReviewCards canWrite={write} />

      <div className="grid gap-6 xl:grid-cols-2">
        {/* On wide screens both tables are visible; on small screens they sit behind tabs. */}
        <div className="xl:col-span-2">
          <div className="mb-3 xl:hidden">
            <Tabs tabs={[{ id: "stock", label: "In Stock", count: stock.data?.length }, { id: "sold", label: "Sold", count: sold.length }]} value={tab} onChange={setTab} />
          </div>
        </div>
        <Card className={tab === "stock" ? "" : "hidden xl:block"}>
          <CardHeader title={`In Stock (${stock.data?.reduce((a, s) => a + s.quantity, 0) ?? 0})`} action={<Link href="/inventory" className="text-xs text-muted hover:text-fg">Manage →</Link>} />
          <Table>
            <thead><tr><Th>Item</Th><Th>Size</Th><Th className="text-right">Qty</Th><Th className="text-right">Cost</Th></tr></thead>
            <tbody>
              {stock.data?.map((s) => (
                <tr key={s.variantId}>
                  <Td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted">{[s.brand, s.condition !== "new" ? s.condition : null].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td>{s.size}</Td>
                  <Td className="text-right num">{s.quantity}</Td>
                  <Td className="text-right"><Money paise={s.avgUnitCostPaise} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {stock.data?.length === 0 && <Empty>Nothing in stock yet. Log a purchase above — one sentence is enough.</Empty>}
        </Card>

        <Card className={tab === "sold" ? "" : "hidden xl:block"}>
          <CardHeader title={`Sold (${sold.length})`} action={<Link href="/sales" className="text-xs text-muted hover:text-fg">All sales →</Link>} />
          <Table>
            <thead><tr><Th>Item</Th><Th>Date</Th><Th className="text-right">Revenue</Th><Th className="text-right">Profit</Th><Th /></tr></thead>
            <tbody>
              {sold.slice(0, 12).map((s) => (
                <tr key={s.id}>
                  <Td>
                    <div className="font-medium">{s.items.map((i) => `${i.name}`).join(", ")}</div>
                    <div className="text-xs text-muted">
                      size {s.items.map((i) => i.size).join(", ")} {s.status !== "completed" && <Badge tone="loss" className="ml-1">{s.status.replace("_", " ")}</Badge>}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-muted">{new Date(s.saleDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Td>
                  <Td className="text-right"><Money paise={s.netProceedsPaise - s.refundedPaise} /></Td>
                  <Td className="text-right"><Money paise={s.netProfitPaise} signed /></Td>
                  <Td className="text-right">
                    <div className="flex justify-end">
                      <InvoiceButton saleId={s.id} label="Invoice" className="px-2" />
                      {write && s.status !== "refunded" && <Button variant="ghost" size="sm" onClick={() => setRefund(s)}>Refund</Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {sold.length === 0 && <Empty>No sales yet. Try &ldquo;Sold the Chicago 10s for ₹22,000&rdquo;.</Empty>}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Revenue vs profit" />
          <div className="px-3 pb-4"><TrendChart data={sum.data?.trend ?? []} /></div>
        </Card>
        <Card>
          <CardHeader title="Sales by category" />
          <div className="px-3 pb-4"><Donut data={sum.data?.byCategory ?? []} /></div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent activity" />
          <ul className="divide-y divide-line">
            {activity.data?.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{a.text}</div>
                  <div className="text-xs text-muted">{new Date(a.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
                </div>
                <div className="shrink-0">
                  {a.kind === "sale" ? <Money paise={a.amountPaise} signed /> : a.kind === "refund" ? <Money paise={-a.amountPaise} /> : <span className="num text-muted"><Money paise={a.amountPaise} /></span>}
                </div>
              </li>
            ))}
          </ul>
          {activity.data?.length === 0 && <Empty>Activity will appear here.</Empty>}
        </Card>
        <Card>
          <CardHeader title="Monthly purchases" />
          <div className="px-3 pb-4"><Bars data={sum.data?.purchaseSpend ?? []} x="month" y="spend" name="Spend" color="#d4b36a" /></div>
        </Card>
      </div>

      <RefundDialog sale={refund} onClose={() => setRefund(null)} />
    </div>
  );
}
