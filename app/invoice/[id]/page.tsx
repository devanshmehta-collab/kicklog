"use client";

import { ArrowLeft, Printer } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { useMe } from "@/components/providers";
import { useGet } from "@/lib/client/api";
import { formatINR } from "@/lib/money";
import type { Invoice } from "@/lib/services/invoice";

/** Plain white, print-ready invoice. Use the browser's Print → "Save as PDF" to get a file you can send. */
export default function InvoicePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useMe();
  const inv = useGet<Invoice>(["invoice", id], user ? `/api/sales/${id}/invoice` : null);
  const [buyer, setBuyer] = React.useState({ name: "", phone: "", city: "" });

  React.useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);
  React.useEffect(() => {
    if (inv.data) setBuyer({ name: inv.data.buyer.name, phone: inv.data.buyer.phone, city: inv.data.buyer.city });
  }, [inv.data]);
  React.useEffect(() => {
    if (inv.data) document.title = `${inv.data.number}${buyer.name ? ` – ${buyer.name}` : ""}`; // becomes the suggested PDF file name
  }, [inv.data, buyer.name]);

  const d = inv.data;
  if (!d) {
    return <div className="flex min-h-dvh items-center justify-center bg-white text-sm text-neutral-500">{inv.isError ? "Could not load this invoice." : "Loading invoice…"}</div>;
  }
  const date = new Date(d.date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const line = "block w-full rounded border border-dashed border-neutral-300 bg-transparent px-1.5 py-1 text-sm placeholder:text-neutral-400 focus:border-neutral-500 focus:outline-none print:border-transparent print:p-0";

  return (
    <div className="min-h-dvh bg-neutral-100 py-6 text-neutral-900 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-[794px] flex-wrap items-center justify-between gap-3 px-4 print:hidden">
        <button onClick={() => (history.length > 1 ? history.back() : router.push("/sales"))} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-black">
          <ArrowLeft size={15} /> Back
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-neutral-500 sm:block">Choose “Save as PDF” in the print window, then send the file.</span>
          <button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-black px-4 text-sm font-medium text-white hover:bg-neutral-800">
            <Printer size={16} /> Print / Save PDF
          </button>
        </div>
      </div>

      <article className="mx-auto max-w-[794px] bg-white p-6 shadow-sm sm:p-12 print:max-w-none print:p-0 print:shadow-none" aria-label={`Invoice ${d.number}`}>
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">{d.seller.name}</h1>
            <div className="mt-2 space-y-0.5 text-sm text-neutral-600">
              {d.seller.address && <p className="max-w-[18rem] whitespace-pre-line">{d.seller.address}</p>}
              {d.seller.phone && <p>{d.seller.phone}</p>}
              {d.seller.gstin && <p>GSTIN: {d.seller.gstin}</p>}
            </div>
          </div>
          <div className="text-left sm:text-right">
            <div className="text-xs font-medium tracking-[0.25em] text-neutral-500">INVOICE</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{d.number}</div>
            <div className="mt-1 text-sm text-neutral-600">{date}</div>
          </div>
        </header>

        <section className="mt-10 max-w-sm">
          <div className="mb-1.5 text-xs font-medium tracking-[0.2em] text-neutral-500">BILL TO</div>
          <input className={`${line} font-medium`} value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} placeholder="Customer name" aria-label="Customer name" />
          <input className={`${line} mt-1`} value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} placeholder="Phone" aria-label="Customer phone" />
          <input className={`${line} mt-1`} value={buyer.city} onChange={(e) => setBuyer({ ...buyer, city: e.target.value })} placeholder="City / address" aria-label="Customer city or address" />
        </section>

        <table className="mt-10 w-full text-sm">
          <thead>
            <tr className="border-b-2 border-neutral-900 text-left text-xs tracking-[0.15em] text-neutral-500">
              <th className="py-2 font-medium">ITEM</th>
              <th className="py-2 text-right font-medium">QTY</th>
              <th className="py-2 pl-3 text-right font-medium">PRICE</th>
              <th className="py-2 pl-3 text-right font-medium">AMOUNT</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i} className="border-b border-neutral-200 align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium">{l.description}</div>
                  <div className="text-xs text-neutral-500">
                    Size {l.size}
                    {l.refundedQuantity > 0 && <span className="ml-2 text-red-600">· {l.refundedQuantity} returned</span>}
                  </div>
                </td>
                <td className="py-3 text-right tabular-nums">{l.quantity}</td>
                <td className="py-3 pl-3 text-right tabular-nums">{formatINR(l.unitPricePaise)}</td>
                <td className="py-3 pl-3 text-right tabular-nums">{formatINR(l.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-6 ml-auto w-full max-w-xs space-y-1.5 text-sm">
          <Row label="Subtotal" value={formatINR(d.subtotalPaise)} />
          {d.discountPaise > 0 && <Row label="Discount" value={`− ${formatINR(d.discountPaise)}`} />}
          {d.shippingPaise > 0 && <Row label="Shipping" value={formatINR(d.shippingPaise)} />}
          <div className="flex items-baseline justify-between border-t-2 border-neutral-900 pt-2 text-lg font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatINR(d.totalPaise)}</dd>
          </div>
          {d.refundedPaise > 0 && (
            <>
              <Row label="Refunded" value={`− ${formatINR(d.refundedPaise)}`} tone="text-red-600" />
              <div className="flex items-baseline justify-between font-semibold">
                <dt>Net paid</dt>
                <dd className="tabular-nums">{formatINR(d.netPaidPaise)}</dd>
              </div>
            </>
          )}
        </dl>

        {d.seller.note && <p className="mt-14 border-t border-neutral-200 pt-5 text-center text-sm text-neutral-500">{d.seller.note}</p>}
      </article>
    </div>
  );
}

function Row({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`flex items-baseline justify-between text-neutral-600 ${tone}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
