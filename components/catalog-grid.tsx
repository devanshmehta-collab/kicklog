"use client";

import * as React from "react";
import { ProductCard } from "@/components/product-card";
import { ProductModal } from "@/components/product-modal";
import type { PublicProduct } from "@/lib/services/catalog";
import { cn } from "@/lib/utils";

export function CatalogGrid({ items, whatsapp }: { items: PublicProduct[]; whatsapp: string }) {
  const cats = [...new Set(items.map((p) => p.category))];
  const [cat, setCat] = React.useState("all");
  const [open, setOpen] = React.useState<PublicProduct | null>(null);
  const shown = cat === "all" ? items : items.filter((p) => p.category === cat);
  const close = React.useCallback(() => setOpen(null), []);
  return (
    <div>
      {cats.length > 1 && (
        <div className="mb-8 flex flex-wrap gap-2" role="tablist" aria-label="Category">
          {["all", ...cats].map((c) => (
            <button key={c} role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={cn("rounded-full border px-4 py-1.5 text-sm capitalize transition-colors", cat === c ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}>
              {c}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((p, i) => (
          <ProductCard key={p.id} p={p} onOpen={() => setOpen(p)} priority={i < 5} />
        ))}
      </div>
      {open && <ProductModal p={open} whatsapp={whatsapp} onClose={close} />}
    </div>
  );
}
