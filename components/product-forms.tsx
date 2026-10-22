"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { PhotoIntake } from "@/components/image-editor";
import { SizePicker } from "@/components/size-picker";
import { Dialog, Field, Input, Select, Textarea } from "@/components/ui/primitives";
import { ApiError, apiFetch, newKey, useGet, useSend } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";

const CATEGORIES = ["sneakers", "apparel", "watches", "bags", "accessories", "other"];
const CONDITIONS = ["new", "new with defects", "like new", "used"];

const Schema = z.object({
  name: z.string().trim().min(1, "Required"),
  brand: z.string().optional(),
  category: z.string().min(1),
  model: z.string().optional(),
  colorway: z.string().optional(),
  sku: z.string().optional(),
  condition: z.string().min(1),
  description: z.string().optional(),
  retail: z.string().optional(),
  price: z.string().optional(),
  status: z.enum(["draft", "published"]),
  lots: z
    .array(
      z.object({
        size: z.string().trim().min(1, "Size"),
        quantity: z.coerce.number().int().min(1, "Qty ≥ 1"),
        cost: z.string().trim().min(1, "Cost"),
      }),
    )
    .min(1),
});
type FormT = z.infer<typeof Schema>;

const rupee = (s?: string) => (s && s.trim() !== "" && !Number.isNaN(Number(s)) ? rupeesToPaise(Number(s)) : null);

export function AddProductDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { register, control, handleSubmit, reset, formState, watch, setValue } = useForm<FormT>({
    resolver: zodResolver(Schema) as never,
    defaultValues: { category: "sneakers", condition: "new", status: "draft", lots: [] },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "lots" });
  const category = watch("category");
  const lots = watch("lots") ?? [];
  const [sharedCost, setSharedCost] = React.useState("");
  const toggleSize = (size: string) => {
    const i = lots.findIndex((l) => l.size === size);
    if (i >= 0) remove(i);
    else append({ size, quantity: 1, cost: sharedCost });
  };
  const applySharedCost = (v: string) => {
    setSharedCost(v);
    lots.forEach((_, i) => setValue(`lots.${i}.cost`, v, { shouldValidate: false }));
  };
  const send = useSend<Record<string, unknown>, { productId: string }>("POST", "/api/products");
  const [images, setImages] = React.useState<{ key: string; url: string }[]>([]);
  const [error, setError] = React.useState("");
  const requestId = React.useRef(newKey());
  const errs = formState.errors;

  /** Called with each finished (cropped & resized) photo from the intake. */
  async function addPhoto(f: File) {
    const fd = new FormData();
    fd.set("file", f);
    try {
      const r = await apiFetch<{ key: string; url: string }>("/api/uploads", { method: "POST", body: fd });
      setImages((cur) => [...cur, r]);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }
  const makeFirst = (i: number) => setImages((cur) => [cur[i], ...cur.filter((_, j) => j !== i)]);
  const removePhoto = (i: number) => setImages((cur) => cur.filter((_, j) => j !== i));

  const onSubmit = handleSubmit(async (v) => {
    setError("");
    try {
      await send.mutateAsync({
        requestId: requestId.current,
        name: v.name,
        brand: v.brand || null,
        category: v.category,
        model: v.model || null,
        colorway: v.colorway || null,
        sku: v.sku || null,
        condition: v.condition,
        description: v.description || null,
        retailPricePaise: rupee(v.retail),
        publicPricePaise: rupee(v.price),
        status: v.status,
        imageKeys: images.map((i) => i.key),
        lots: v.lots.map((l) => ({ size: l.size, quantity: l.quantity, unitCostPaise: rupeesToPaise(Number(l.cost)) })),
      });
      reset();
      setImages([]);
      requestId.current = newKey();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  });

  return (
    <Dialog open={open} onClose={onClose} title="Add product" wide>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product name" error={errs.name?.message} className="sm:col-span-2"><Input {...register("name")} placeholder="Air Jordan 1 High Chicago" /></Field>
          <Field label="Brand"><Input {...register("brand")} /></Field>
          <Field label="Category"><Select {...register("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Model"><Input {...register("model")} /></Field>
          <Field label="Colorway"><Input {...register("colorway")} /></Field>
          <Field label="SKU"><Input {...register("sku")} /></Field>
          <Field label="Condition"><Select {...register("condition")}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Retail reference price (₹)"><Input inputMode="decimal" {...register("retail")} /></Field>
          <Field label="Public selling price (₹)"><Input inputMode="decimal" {...register("price")} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea rows={2} {...register("description")} /></Field>
        </div>

        <div className="space-y-3">
          <SizePicker category={category} selected={lots.map((l) => l.size)} onToggle={toggleSize} label="Sizes you have" />
          {fields.length > 0 && (
            <div className="rounded-xl border border-line p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted">Quantity and cost for each size</span>
                <label className="flex items-center gap-2 text-xs text-muted">
                  Same cost for all ₹
                  <Input className="h-8 w-28" inputMode="decimal" placeholder="e.g. 18000" value={sharedCost} onChange={(e) => applySharedCost(e.target.value)} aria-label="Same unit cost for every size" />
                </label>
              </div>
              <div className="space-y-2">
                {fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[64px_80px_1fr_36px] items-center gap-2">
                    <span className="rounded-lg bg-raised px-2 py-2 text-center text-sm font-medium">{lots[i]?.size}</span>
                    <Input placeholder="Qty" aria-label={`Quantity for size ${lots[i]?.size}`} inputMode="numeric" {...register(`lots.${i}.quantity`)} />
                    <Input placeholder="Unit cost ₹" aria-label={`Unit cost for size ${lots[i]?.size}`} inputMode="decimal" {...register(`lots.${i}.cost`)} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove size ${lots[i]?.size}`} onClick={() => remove(i)}><Trash2 size={15} /></Button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {errs.lots ? <p role="alert" className="text-xs text-loss">Pick at least one size, and give every size a quantity and a cost.</p> : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Photos <span className="font-normal">· the first one is the cover on the shop</span></span>
          </div>
          {images.length > 0 && (
            <div className="mb-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {images.map((im, i) => (
                <div key={im.key} className="group relative aspect-[4/5] overflow-hidden rounded-lg border border-line">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={im.url} alt={`Product photo ${i + 1}`} className="h-full w-full object-cover" />
                  {i === 0 && <span className="absolute top-1 left-1 rounded bg-bg/80 px-1.5 py-0.5 text-[10px]">Cover</span>}
                  <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-bg/90 to-transparent p-1 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                    {i > 0 ? <button type="button" onClick={() => makeFirst(i)} className="rounded bg-bg/80 px-1.5 py-0.5 text-[10px]">Cover</button> : <span />}
                    <button type="button" onClick={() => removePhoto(i)} aria-label="Remove photo" className="rounded bg-bg/80 p-0.5 text-loss"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <PhotoIntake onCropped={addPhoto} enabled={open} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Field label="After saving"><Select {...register("status")}><option value="draft">Keep as draft (private)</option><option value="published">Publish to catalog</option></Select></Field>
          <div className="flex items-center gap-2 pt-5">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button disabled={send.isPending}>{send.isPending ? "Saving…" : "Save product"}</Button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-loss">{error}</p>}
      </form>
    </Dialog>
  );
}

export interface ProductLite {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  model: string | null;
  colorway: string | null;
  sku: string | null;
  condition: string;
  description: string | null;
  status: "draft" | "published" | "archived";
  publicPricePaise: number | null;
  retailPricePaise: number | null;
}

export function EditProductDialog({ product, onClose }: { product: ProductLite | null; onClose: () => void }) {
  const [f, setF] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const send = useSend<Record<string, unknown>, unknown>("PATCH", `/api/products/${product?.id}`);
  React.useEffect(() => {
    if (!product) return;
    setF({
      name: product.name, brand: product.brand ?? "", category: product.category, model: product.model ?? "", colorway: product.colorway ?? "",
      sku: product.sku ?? "", condition: product.condition, description: product.description ?? "",
      retail: product.retailPricePaise != null ? String(product.retailPricePaise / 100) : "",
      price: product.publicPricePaise != null ? String(product.publicPricePaise / 100) : "",
    });
    setError("");
  }, [product]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    try {
      await send.mutateAsync({
        name: f.name, brand: f.brand || null, category: f.category, model: f.model || null, colorway: f.colorway || null, sku: f.sku || null,
        condition: f.condition, description: f.description || null, retailPricePaise: rupee(f.retail), publicPricePaise: rupee(f.price),
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  return (
    <Dialog open={!!product} onClose={onClose} title="Edit product" wide>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name ?? ""} onChange={set("name")} /></Field>
        <Field label="Brand"><Input value={f.brand ?? ""} onChange={set("brand")} /></Field>
        <Field label="Category"><Select value={f.category ?? ""} onChange={set("category")}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Model"><Input value={f.model ?? ""} onChange={set("model")} /></Field>
        <Field label="Colorway"><Input value={f.colorway ?? ""} onChange={set("colorway")} /></Field>
        <Field label="SKU"><Input value={f.sku ?? ""} onChange={set("sku")} /></Field>
        <Field label="Condition"><Select value={f.condition ?? ""} onChange={set("condition")}>{CONDITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Retail reference (₹)"><Input value={f.retail ?? ""} onChange={set("retail")} inputMode="decimal" /></Field>
        <Field label="Public price (₹)"><Input value={f.price ?? ""} onChange={set("price")} inputMode="decimal" /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea rows={3} value={f.description ?? ""} onChange={set("description")} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={send.isPending}>Save changes</Button></div>
    </Dialog>
  );
}

interface Partner { partnerId: string | null; name: string }

export function RestockDialog({ product, onClose }: { product: { id: string; name: string; category?: string } | null; onClose: () => void }) {
  const [f, setF] = React.useState({ size: "", quantity: "1", cost: "", intl: false, currency: "USD", price: "", fx: "", country: "", intlShip: "", duty: "", fees: "", domShip: "", supplierId: "", partnerId: "", ownPct: "50", profitPct: "50" });
  const [error, setError] = React.useState("");
  const keyRef = React.useRef(newKey());
  const suppliers = useGet<{ id: string; name: string }[]>(["suppliers"], product ? "/api/suppliers" : null);
  const partners = useGet<{ ledger: Partner[] }>(["partners"], product ? "/api/partners" : null);
  const send = useSend<Record<string, unknown>, unknown>("POST", `/api/products/${product?.id}/restock`);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const paise = (v: string) => (v ? rupeesToPaise(Number(v)) : undefined);

  async function save() {
    setError("");
    const lot: Record<string, unknown> = { size: f.size || "OS", quantity: Number(f.quantity), supplierId: f.supplierId || null };
    if (f.intl) {
      lot.landed = {
        foreignCurrency: f.currency, foreignUnitPriceMinor: Math.round(Number(f.price) * 100), fxRate: Number(f.fx), countryOfOrigin: f.country || null,
        internationalShippingPaise: paise(f.intlShip), customsDutyPaise: paise(f.duty), paymentFeesPaise: paise(f.fees), domesticShippingPaise: paise(f.domShip),
      };
    } else lot.unitCostPaise = rupeesToPaise(Number(f.cost));
    if (f.partnerId) lot.partners = [{ partnerId: f.partnerId, ownershipBps: Math.round(Number(f.ownPct) * 100), profitShareBps: Math.round(Number(f.profitPct) * 100) }];
    try {
      await send.mutateAsync({ requestId: keyRef.current, lot });
      keyRef.current = newKey();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not restock");
    }
  }

  return (
    <Dialog open={!!product} onClose={onClose} title={`Restock — ${product?.name ?? ""}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><SizePicker category={product?.category ?? "sneakers"} selected={f.size ? [f.size] : []} onToggle={(sz) => setF((x) => ({ ...x, size: x.size === sz ? "" : sz }))} label="Size" /></div>
        <Field label="Quantity"><Input value={f.quantity} onChange={set("quantity")} inputMode="numeric" /></Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.intl} onChange={(e) => setF({ ...f, intl: e.target.checked })} /> International purchase (landed cost)</label>
        {!f.intl ? (
          <Field label="Unit cost (₹), all-in" className="sm:col-span-2"><Input value={f.cost} onChange={set("cost")} inputMode="decimal" /></Field>
        ) : (
          <>
            <Field label="Currency"><Input value={f.currency} onChange={set("currency")} /></Field>
            <Field label="Supplier price per unit"><Input value={f.price} onChange={set("price")} inputMode="decimal" /></Field>
            <Field label="Exchange rate (₹ per 1)"><Input value={f.fx} onChange={set("fx")} inputMode="decimal" /></Field>
            <Field label="Country of origin"><Input value={f.country} onChange={set("country")} /></Field>
            <Field label="Intl shipping (₹, total)"><Input value={f.intlShip} onChange={set("intlShip")} inputMode="decimal" /></Field>
            <Field label="Customs duty (₹, total)"><Input value={f.duty} onChange={set("duty")} inputMode="decimal" /></Field>
            <Field label="Payment fees (₹, total)"><Input value={f.fees} onChange={set("fees")} inputMode="decimal" /></Field>
            <Field label="Domestic shipping (₹, total)"><Input value={f.domShip} onChange={set("domShip")} inputMode="decimal" /></Field>
          </>
        )}
        <Field label="Supplier"><Select value={f.supplierId} onChange={set("supplierId")}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Co-invested with partner"><Select value={f.partnerId} onChange={set("partnerId")}><option value="">None (100% mine)</option>{partners.data?.ledger?.filter((p) => p.partnerId).map((p) => <option key={p.partnerId!} value={p.partnerId!}>{p.name}</option>)}</Select></Field>
        {f.partnerId && (
          <>
            <Field label="Partner capital share %"><Input value={f.ownPct} onChange={set("ownPct")} inputMode="decimal" /></Field>
            <Field label="Partner profit share %"><Input value={f.profitPct} onChange={set("profitPct")} inputMode="decimal" /></Field>
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={send.isPending}>Add stock</Button></div>
    </Dialog>
  );
}
