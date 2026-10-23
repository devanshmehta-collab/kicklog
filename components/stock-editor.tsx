"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { SizePicker } from "@/components/size-picker";
import { Input } from "@/components/ui/primitives";
import { apiFetch, newKey, useGet } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import { sortSizes } from "@/lib/sizes";
import type { getProductDetail } from "@/lib/services/inventory";

type Detail = Awaited<ReturnType<typeof getProductDetail>>;
interface Row {
  qty: string;
  cost: string;
}

/**
 * Stock section for the Edit product dialog: add units to existing sizes, or add brand-new sizes, in the same place
 * you edit the listing. Each batch is recorded as a real acquisition lot (with its own cost) through the restock API,
 * so stock history and profit stay correct.
 */
export function useStockEditor(product: { id: string; category: string } | null) {
  const qc = useQueryClient();
  const detail = useGet<Detail>(["product", product?.id], product ? `/api/products/${product.id}` : null);
  const [rows, setRows] = React.useState<Record<string, Row>>({});
  const [newSizes, setNewSizes] = React.useState<string[]>([]);
  const keys = React.useRef<Record<string, string>>({});

  React.useEffect(() => {
    setRows({});
    setNewSizes([]);
    keys.current = {};
  }, [product?.id]);

  const lots = detail.data?.lots ?? [];
  const variants = detail.data?.variants ?? [];
  const latest = [...lots].sort((a, b) => +new Date(b.purchaseDate) - +new Date(a.purchaseDate));
  const rupees = (paise: number | undefined) => (paise == null ? "" : String(paise / 100));
  const defaultCost = (variantId?: string) => rupees((latest.find((l) => l.variantId === variantId) ?? latest[0])?.unitCostPaise);

  const existing = sortSizes(variants.map((v) => v.size));
  const stockOf = (size: string) => {
    const v = variants.find((x) => x.size === size);
    return lots.filter((l) => l.variantId === v?.id).reduce((a, l) => a + l.quantityRemaining, 0);
  };
  const costFor = (size: string) => defaultCost(variants.find((x) => x.size === size)?.id);

  const set = (size: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [size]: { qty: r[size]?.qty ?? "", cost: r[size]?.cost ?? "", ...patch } }));
  const toggleNew = (size: string) => {
    if (existing.includes(size)) return; // already listed above
    setNewSizes((cur) => (cur.includes(size) ? cur.filter((s) => s !== size) : [...cur, size]));
    setRows((r) => (r[size] ? r : { ...r, [size]: { qty: "1", cost: "" } }));
  };

  const all = [...existing, ...sortSizes(newSizes)];
  const qtyOf = (s: string) => Math.max(0, Math.floor(Number(rows[s]?.qty) || 0));
  const pendingUnits = all.reduce((a, s) => a + qtyOf(s), 0);

  /** Records every batch with units > 0. Throws an Error with a plain message if something is missing or fails. */
  async function submit() {
    const todo = all.filter((s) => qtyOf(s) > 0);
    for (const size of todo) {
      const costText = (rows[size]?.cost ?? "").trim() || costFor(size) || defaultCost();
      const cost = Number(costText);
      if (!costText || !Number.isFinite(cost) || cost < 0) throw new Error(`Enter what each unit of size ${size} cost you.`);
      keys.current[size] ??= newKey();
      await apiFetch(`/api/products/${product!.id}/restock`, {
        method: "POST",
        json: { requestId: keys.current[size], lot: { size, quantity: qtyOf(size), unitCostPaise: rupeesToPaise(cost) } },
      });
      delete keys.current[size]; // done: a later top-up of the same size is a new batch
      setRows((r) => ({ ...r, [size]: { qty: "", cost: r[size]?.cost ?? "" } }));
      setNewSizes((cur) => cur.filter((s) => s !== size));
    }
    if (todo.length) await qc.invalidateQueries();
  }

  const element = (
    <section className="mt-5 space-y-4 rounded-xl border border-line p-4" aria-label="Stock">
      <div>
        <h4 className="text-sm font-semibold">Stock</h4>
        <p className="text-xs text-muted">Add units you have bought. Each batch is saved with its own cost, so your profit stays accurate.</p>
      </div>

      {detail.isLoading && <p className="text-sm text-muted">Loading stock…</p>}

      {all.length > 0 && (
        <div className="space-y-2">
          <div className="hidden grid-cols-[64px_72px_96px_1fr_36px] gap-2 px-1 text-[11px] text-muted sm:grid">
            <span>Size</span><span>In stock</span><span>Add units</span><span>Cost per unit ₹</span><span />
          </div>
          {all.map((size) => {
            const isNew = newSizes.includes(size);
            return (
              <div key={size} className="grid grid-cols-[56px_1fr_36px] items-center gap-2 sm:grid-cols-[64px_72px_96px_1fr_36px]">
                <span className="rounded-lg bg-raised px-2 py-2 text-center text-sm font-medium">{size}</span>
                <span className="hidden text-sm text-muted sm:block">{isNew ? <em className="text-accent not-italic">new</em> : stockOf(size)}</span>
                <div className="col-span-1 grid grid-cols-2 gap-2 sm:contents">
                  <div className="relative">
                    <Input inputMode="numeric" placeholder="+ units" value={rows[size]?.qty ?? ""} onChange={(e) => set(size, { qty: e.target.value.replace(/[^\d]/g, "") })} aria-label={`Units to add to size ${size}`} />
                    <span className="mt-1 block text-[11px] text-muted sm:hidden">{isNew ? "new size" : `${stockOf(size)} in stock`}</span>
                  </div>
                  <Input inputMode="decimal" placeholder={costFor(size) ? `₹${costFor(size)}` : "Cost ₹"} title="Cost per unit. Leave as is to use the last cost." value={rows[size]?.cost ?? ""} onChange={(e) => set(size, { cost: e.target.value })} aria-label={`Cost per unit for size ${size}`} />
                </div>
                {isNew ? (
                  <button type="button" onClick={() => toggleNew(size)} aria-label={`Remove new size ${size}`} className="rounded-lg p-2 text-muted hover:bg-raised hover:text-loss"><Trash2 size={15} /></button>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}

      <SizePicker category={product?.category ?? "sneakers"} selected={all} onToggle={toggleNew} label="Add another size" />
      <p className="text-xs text-muted">To take units out (damaged, miscount), use the Lots &amp; stock button on the Inventory list.</p>
    </section>
  );

  return { element, submit, pendingUnits };
}
