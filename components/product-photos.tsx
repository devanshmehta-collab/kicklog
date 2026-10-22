"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Star, Trash2 } from "lucide-react";
import * as React from "react";
import { PhotoIntake } from "@/components/image-editor";
import { Dialog } from "@/components/ui/primitives";
import { apiFetch, useGet } from "@/lib/client/api";
import type { getProductDetail } from "@/lib/services/inventory";

/** Manage the photos of an existing product: add (paste / drop / choose → crop), set the cover, delete. */
export function ProductPhotosDialog({ product, onClose }: { product: { id: string; name: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const detail = useGet<Awaited<ReturnType<typeof getProductDetail>>>(["product", product?.id], product ? `/api/products/${product.id}` : null);
  const [error, setError] = React.useState("");

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["product", product?.id] }), qc.invalidateQueries({ queryKey: ["products"] })]);

  async function add(f: File) {
    const fd = new FormData();
    fd.set("file", f);
    try {
      await apiFetch(`/api/products/${product!.id}/images`, { method: "POST", body: fd });
      setError("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }
  async function act(imageId: string, kind: "primary" | "delete") {
    try {
      if (kind === "delete") await apiFetch(`/api/products/${product!.id}/images/${imageId}`, { method: "DELETE" });
      else await apiFetch(`/api/products/${product!.id}/images/${imageId}`, { method: "PATCH", json: { primary: true } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }
  const images = detail.data?.images ?? [];

  return (
    <Dialog open={!!product} onClose={onClose} title={`Photos — ${product?.name ?? ""}`} wide>
      <p className="mb-4 text-sm text-muted">Shop cards show photos at 4:5. Every photo you add opens in the crop &amp; resize editor so it looks right for customers.</p>
      {images.length > 0 ? (
        <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {images.map((im, i) => (
            <div key={im.id} className="group relative aspect-[4/5] overflow-hidden rounded-xl border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={im.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
              {im.isPrimary && <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-bg/80 px-2 py-0.5 text-[10px] font-medium"><Star size={10} className="text-accent" /> Cover</span>}
              <div className="absolute inset-x-0 bottom-0 flex justify-between gap-1 bg-gradient-to-t from-bg/90 to-transparent p-2 opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100">
                {!im.isPrimary ? <button onClick={() => act(im.id, "primary")} className="rounded-lg bg-bg/80 px-2 py-1 text-xs">Make cover</button> : <span />}
                <button onClick={() => act(im.id, "delete")} aria-label="Delete photo" className="rounded-lg bg-bg/80 p-1.5 text-loss"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mb-5 rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">No photos yet.</p>
      )}
      <PhotoIntake onCropped={add} enabled={!!product} />
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
    </Dialog>
  );
}
