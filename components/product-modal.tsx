"use client";

import { ChevronLeft, ChevronRight, MessageCircle, X } from "lucide-react";
import * as React from "react";
import { formatINR } from "@/lib/money";
import type { PublicProduct } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

/** Large detail window: gallery, price, available sizes and a Buy button that opens WhatsApp with the chosen size. */
export function ProductModal({ p, whatsapp, onClose }: { p: PublicProduct; whatsapp: string; onClose: () => void }) {
  const [img, setImg] = React.useState(0);
  const [size, setSize] = React.useState<string | null>(p.sizes.length === 1 ? p.sizes[0] : null);
  const [hint, setHint] = React.useState(false);
  const n = p.images.length;
  const go = React.useCallback((d: number) => n && setImg((i) => (i + d + n) % n), [n]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, go]);

  function buy() {
    if (p.sizes.length > 1 && !size) {
      setHint(true);
      return;
    }
    const text = [
      `Hi! I want to buy ${p.name}${size ? ` (size ${size})` : ""} — ${formatINR(p.pricePaise)}`,
      p.sku ? `SKU: ${p.sku}` : null,
      `${location.origin}/shop/${p.id}`,
    ]
      .filter(Boolean)
      .join("\n");
    const url = whatsapp ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(text)}` : `/shop/${p.id}`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={p.name} className="rise scroll-thin relative grid max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl border border-line bg-surface sm:rounded-3xl md:grid-cols-[1.1fr_1fr]">
        <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 z-10 rounded-full bg-bg/80 p-2 text-fg backdrop-blur hover:bg-bg">
          <X size={18} />
        </button>

        {/* gallery */}
        <div className="bg-raised md:sticky md:top-0 md:self-start">
          <div className="relative aspect-[4/5] overflow-hidden max-md:aspect-auto max-md:h-[38dvh]">
            {p.images[img] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.images[img]} alt={`${p.name} photo ${img + 1}`} className="h-full w-full object-cover max-md:object-contain" />
            ) : (
              <div className="grain flex h-full items-center justify-center text-xs tracking-widest text-muted uppercase">Photo soon</div>
            )}
            {n > 1 && (
              <>
                <button onClick={() => go(-1)} aria-label="Previous photo" className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-bg/70 p-2 backdrop-blur hover:bg-bg">
                  <ChevronLeft size={18} />
                </button>
                <button onClick={() => go(1)} aria-label="Next photo" className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-bg/70 p-2 backdrop-blur hover:bg-bg">
                  <ChevronRight size={18} />
                </button>
                <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                  {p.images.map((_, i) => (
                    <span key={i} className={cn("h-1.5 rounded-full transition-all", i === img ? "w-5 bg-fg" : "w-1.5 bg-fg/40")} />
                  ))}
                </div>
              </>
            )}
          </div>
          {n > 1 && (
            <div className="scroll-thin flex gap-2 overflow-x-auto p-3">
              {p.images.map((u, i) => (
                <button key={u + i} onClick={() => setImg(i)} aria-label={`Photo ${i + 1}`} aria-current={i === img} className={cn("h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2", i === img ? "border-fg" : "border-transparent opacity-70 hover:opacity-100")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* details */}
        <div className="flex flex-col gap-6 p-6 sm:p-8">
          <div>
            <div className="text-[11px] tracking-[0.18em] text-muted uppercase">{[p.brand, p.category].filter(Boolean).join(" · ")}</div>
            <h2 className="display mt-2 pr-8 text-3xl">{p.name}</h2>
            {p.colorway && <div className="mt-1.5 text-sm text-muted">{p.colorway}</div>}
            <div className="num mt-4 text-3xl font-semibold">{formatINR(p.pricePaise)}</div>
          </div>

          <div>
            <div className="mb-2.5 flex items-center justify-between text-sm">
              <span className="font-medium">{p.sizes.length > 1 ? "Select size" : "Size"}</span>
              <span className="text-xs text-muted capitalize">{p.condition}</span>
            </div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Size">
              {p.sizes.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={size === s}
                  onClick={() => {
                    setSize(s);
                    setHint(false);
                  }}
                  className={cn("min-w-12 rounded-xl border px-3.5 py-2 text-sm transition-colors", size === s ? "border-fg bg-fg text-bg" : "border-line hover:border-fg/50")}
                >
                  {s}
                </button>
              ))}
            </div>
            {hint && (
              <p role="alert" className="mt-2 text-sm text-review">
                Pick a size first.
              </p>
            )}
          </div>

          {p.description && <p className="text-sm leading-relaxed whitespace-pre-line text-muted">{p.description}</p>}

          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 border-t border-line pt-5 text-sm">
            {p.sku && (
              <>
                <dt className="text-muted">SKU</dt>
                <dd>{p.sku}</dd>
              </>
            )}
            {p.brand && (
              <>
                <dt className="text-muted">Brand</dt>
                <dd>{p.brand}</dd>
              </>
            )}
            <dt className="text-muted">Condition</dt>
            <dd className="capitalize">{p.condition}</dd>
          </dl>

          {/* on phones the Buy button stays pinned to the bottom of the sheet so it is always reachable */}
          <div className="mt-auto max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-6 max-md:-mb-6 max-md:border-t max-md:border-line max-md:bg-surface/95 max-md:p-4 max-md:backdrop-blur sm:max-md:-mx-8 sm:max-md:-mb-8">
            <button onClick={buy} className="inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#25D366] text-base font-semibold text-black transition hover:brightness-110 active:scale-[0.99]">
              <MessageCircle size={20} /> Buy on WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
