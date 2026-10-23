"use client";

import { Search, X } from "lucide-react";
import * as React from "react";
import { BrandMarquee } from "@/components/brand-marquee";
import { ProductCard } from "@/components/product-card";
import { ProductModal } from "@/components/product-modal";
import { Reveal } from "@/components/reveal";
import { Spotlight } from "@/components/spotlight";
import type { PublicProduct } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

type Sort = "new" | "low" | "high";

export function Storefront({ items, whatsapp }: { items: PublicProduct[]; whatsapp: string }) {
  const [cat, setCat] = React.useState("all");
  const [sort, setSort] = React.useState<Sort>("new");
  const [q, setQ] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [open, setOpen] = React.useState<PublicProduct | null>(null);
  const close = React.useCallback(() => setOpen(null), []);

  const cats = [...new Set(items.map((p) => p.category))];
  const brands = [...new Set(items.map((p) => p.brand).filter((b): b is string => !!b))];
  // the newest pieces that have a photo lead the page
  const featured = React.useMemo(() => [...items].filter((p) => p.images[0]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [items]);

  const shown = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = items.filter((p) => (cat === "all" || p.category === cat) && (!term || [p.name, p.brand, p.colorway, p.sku].some((x) => x?.toLowerCase().includes(term))));
    return list.sort((a, b) => (sort === "low" ? a.pricePaise - b.pricePaise : sort === "high" ? b.pricePaise - a.pricePaise : b.createdAt.localeCompare(a.createdAt)));
  }, [items, cat, sort, q]);

  return (
    <>
      {featured.length > 0 ? (
        <Spotlight items={featured} onOpen={setOpen} />
      ) : (
        <section className="mx-auto max-w-[1500px] px-4 pt-16 pb-10 sm:px-8">
          <h1 className="display text-[clamp(2.8rem,9vw,7rem)]">Fresh pairs<br /><span className="text-muted">landing soon.</span></h1>
        </section>
      )}

      <BrandMarquee brands={brands} />

      {/* sticky filter bar */}
      <div className="sticky top-14 z-20 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-8">
          <div className="scroll-thin flex min-w-0 flex-1 gap-2 overflow-x-auto" role="tablist" aria-label="Category">
            {["all", ...cats].map((c) => (
              <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("shrink-0 rounded-full px-4 py-1.5 text-sm capitalize transition-colors", cat === c ? "bg-fg font-medium text-bg" : "text-muted hover:text-fg")}>
                {c === "all" ? "All" : c}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {searching || q ? (
              <div className="relative">
                <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => !q && setSearching(false)} placeholder="Search" aria-label="Search products" className="h-9 w-36 rounded-full border border-line bg-raised pr-8 pl-8 text-sm placeholder:text-muted/70 focus:border-fg/50 sm:w-52" />
                <button aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => { setQ(""); setSearching(false); }} className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted hover:text-fg"><X size={14} /></button>
              </div>
            ) : (
              <button aria-label="Search" onClick={() => setSearching(true)} className="flex h-9 w-9 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-fg"><Search size={16} /></button>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort" className="h-9 rounded-full border border-line bg-transparent px-3 text-sm text-muted hover:text-fg focus:border-fg/50">
              <option value="new">Newest</option>
              <option value="low">Price ↑</option>
              <option value="high">Price ↓</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1500px] px-4 pt-8 sm:px-8">
        {shown.length === 0 ? (
          <p className="py-24 text-center text-muted">Nothing matches. <button className="underline underline-offset-4 hover:text-fg" onClick={() => { setCat("all"); setQ(""); }}>Clear filters</button></p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
            {shown.map((p, i) => (
              <Reveal key={p.id} delay={(i % 4) * 70}>
                <ProductCard p={p} onOpen={() => setOpen(p)} priority={i < 4} />
              </Reveal>
            ))}
          </div>
        )}
      </div>

      {open && <ProductModal p={open} whatsapp={whatsapp} onClose={close} />}
    </>
  );
}
