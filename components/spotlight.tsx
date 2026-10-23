"use client";

import { ArrowUpRight } from "lucide-react";
import * as React from "react";
import { formatINR } from "@/lib/money";
import type { PublicProduct } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

const SLIDE_MS = 6500;

/** Full-width feature of the newest pieces. Auto-advances, pauses on hover, tap a segment to jump. */
export function Spotlight({ items, onOpen }: { items: PublicProduct[]; onOpen: (p: PublicProduct) => void }) {
  const [i, setI] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const [round, setRound] = React.useState(0); // restarts the progress bar after a pause
  const n = items.length;
  const p = items[Math.min(i, n - 1)];

  React.useEffect(() => {
    if (n < 2 || paused) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), SLIDE_MS);
    return () => clearTimeout(t);
  }, [i, paused, n, round]);

  if (!p) return null;
  const shownSizes = p.sizes.slice(0, 7);

  return (
    <section
      className="relative isolate overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        setPaused(false);
        setRound((r) => r + 1);
      }}
      aria-roledescription="carousel"
      aria-label="New in"
    >
      {/* ambient glow + oversized brand watermark */}
      <div aria-hidden className="glow pointer-events-none absolute -top-40 right-[-10%] -z-10 h-[34rem] w-[34rem] rounded-full bg-accent/20 blur-[120px]" />
      <div aria-hidden className="outline-text pointer-events-none absolute -bottom-10 left-0 -z-10 w-full overflow-hidden text-[22vw] leading-none font-bold whitespace-nowrap select-none font-display opacity-35">
        {(p.brand ?? p.category).toUpperCase()}
      </div>

      <div className="mx-auto grid max-w-[1500px] items-center gap-6 px-4 pt-5 pb-12 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-14 lg:pb-20">
        {/* image */}
        <div className="order-1 lg:order-2" key={p.id}>
          <button
            type="button"
            onClick={() => onOpen(p)}
            aria-label={`View ${p.name}`}
            className="pop group relative mx-auto block aspect-[4/5] w-full max-w-[34rem] max-lg:aspect-auto max-lg:h-[40dvh] overflow-hidden rounded-[2rem] border border-white/10 bg-surface shadow-[0_40px_120px_-30px_rgb(var(--accent)/0.35)] lg:ml-auto"
          >
            {p.images[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.images[0]} alt={p.name} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
            ) : (
              <div className="grain absolute inset-0" />
            )}
            <span className="absolute top-4 right-4 inline-flex h-11 w-11 items-center justify-center rounded-full bg-fg text-bg transition-transform group-hover:rotate-45">
              <ArrowUpRight size={18} />
            </span>
          </button>
        </div>

        {/* copy */}
        <div className="order-2 lg:order-1" key={`t-${p.id}`}>
          <div className="pop flex items-center gap-3 text-[11px] font-medium tracking-[0.22em] text-muted uppercase">
            <span className="text-accent">New in</span>
            <span className="h-px w-8 bg-line" />
            <span className="num">{String(Math.min(i, n - 1) + 1).padStart(2, "0")} / {String(n).padStart(2, "0")}</span>
          </div>
          <h1 className="display pop mt-5 text-[clamp(2.6rem,7vw,6.2rem)] [animation-delay:60ms]">{p.name}</h1>
          {(p.brand || p.colorway) && <p className="pop mt-4 text-base text-muted [animation-delay:120ms]">{[p.brand, p.colorway].filter(Boolean).join("  ·  ")}</p>}

          <div className="pop mt-8 flex flex-wrap items-end gap-x-8 gap-y-5 [animation-delay:180ms]">
            <div className="num font-display text-4xl font-semibold tracking-tight sm:text-5xl">{formatINR(p.pricePaise)}</div>
            {shownSizes.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Available sizes">
                {shownSizes.map((s) => (
                  <span key={s} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted">{s}</span>
                ))}
                {p.sizes.length > shownSizes.length && <span className="px-1 py-1 text-xs text-muted">+{p.sizes.length - shownSizes.length}</span>}
              </div>
            )}
          </div>

          <button onClick={() => onOpen(p)} className="pop mt-9 inline-flex h-14 items-center gap-3 rounded-full bg-fg pr-2 pl-7 text-[15px] font-semibold text-bg transition hover:bg-fg/90 active:scale-[0.98] [animation-delay:240ms]">
            View &amp; buy
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-bg text-fg"><ArrowUpRight size={17} /></span>
          </button>

          {n > 1 && (
            <div className="relative z-10 mt-12 flex max-w-sm gap-2" role="tablist" aria-label="Choose a featured piece">
              {items.map((it, idx) => (
                <button key={it.id} role="tab" aria-selected={idx === i} aria-label={`Show ${it.name}`} onClick={() => { setI(idx); setRound((r) => r + 1); }} className="group relative h-6 flex-1">
                  <span className="absolute top-1/2 right-0 left-0 block h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
                    {idx < i && <span className="absolute inset-0 bg-fg/70" />}
                    {idx === i && <span key={`${i}-${round}`} className={cn("progress-fill absolute inset-0 bg-fg")} style={{ "--dur": `${SLIDE_MS}ms`, animationPlayState: paused ? "paused" : "running" } as React.CSSProperties} />}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
