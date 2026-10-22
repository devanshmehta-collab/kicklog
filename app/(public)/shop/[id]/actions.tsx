"use client";

import { Check, Copy, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { PublicProduct } from "@/lib/services/catalog";

function waLink(number: string, p: PublicProduct, size: string | null) {
  const text = `Hi! I'm interested in ${p.name}${size ? ` (size ${size})` : ""} — ${formatINR(p.pricePaise)}${p.sku ? ` — SKU ${p.sku}` : ""}\n${location.origin}/shop/${p.id}`;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

export function ProductActions({ product: p, whatsapp, phone }: { product: PublicProduct; whatsapp: string; phone: string }) {
  const [img, setImg] = React.useState(0);
  const [size, setSize] = React.useState<string | null>(p.sizes.length === 1 ? p.sizes[0] : null);
  const [copied, setCopied] = React.useState(false);

  function copyInfo() {
    const text = [p.name, p.colorway, size ? `Size ${size}` : p.sizes.length ? `Sizes ${p.sizes.join(", ")}` : null, formatINR(p.pricePaise), p.sku && `SKU ${p.sku}`, `${location.origin}/shop/${p.id}`].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div>
        <div className="aspect-square overflow-hidden rounded-2xl border border-line bg-raised">
          {p.images[img] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.images[img]} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">Photo coming soon</div>
          )}
        </div>
        {p.images.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto scroll-thin">
            {p.images.map((u, i) => (
              <button key={u} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`} className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2", i === img ? "border-fg" : "border-line")}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div>
          <Link href="/shop" className="text-xs text-muted hover:text-fg">← All products</Link>
          <div className="mt-3 text-sm text-muted">{[p.brand, p.category].filter(Boolean).join(" · ")}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{p.name}</h1>
          {p.colorway && <div className="mt-1 text-sm text-muted">{p.colorway}</div>}
          <div className="num mt-4 text-3xl font-semibold">{formatINR(p.pricePaise)}</div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm"><span className="font-medium">Available sizes</span><span className="text-xs text-muted capitalize">{p.condition}</span></div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
            {p.sizes.map((s) => (
              <button key={s} role="radio" aria-checked={size === s} onClick={() => setSize(size === s ? null : s)} className={cn("min-w-12 rounded-xl border px-3.5 py-2 text-sm", size === s ? "border-fg bg-fg text-bg" : "border-line hover:border-fg/50")}>{s}</button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {whatsapp ? (
            <a href="#" suppressHydrationWarning onClick={(e) => { e.currentTarget.href = waLink(whatsapp, p, size); }} target="_blank" rel="noreferrer" className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#25D366] font-medium text-black hover:opacity-90">
              <MessageCircle size={18} /> Enquire on WhatsApp
            </a>
          ) : (
            <div className="flex h-12 flex-1 items-center justify-center rounded-xl border border-line text-sm text-muted">WhatsApp number not configured</div>
          )}
          {phone && <a href={`tel:${phone}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line px-5 text-sm hover:bg-raised"><Phone size={16} /> Call</a>}
          <button onClick={copyInfo} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line px-5 text-sm hover:bg-raised">{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Copied" : "Copy info"}</button>
        </div>

        <dl className="grid grid-cols-2 gap-y-2 border-t border-line pt-5 text-sm">
          {p.sku && (<><dt className="text-muted">SKU</dt><dd>{p.sku}</dd></>)}
          {p.brand && (<><dt className="text-muted">Brand</dt><dd>{p.brand}</dd></>)}
          <dt className="text-muted">Condition</dt><dd className="capitalize">{p.condition}</dd>
        </dl>
        {p.description && <p className="text-sm leading-relaxed whitespace-pre-line text-muted">{p.description}</p>}
      </div>
    </>
  );
}
