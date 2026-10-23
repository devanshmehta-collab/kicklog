import { formatINR } from "@/lib/money";
import type { PublicProduct } from "@/lib/services/catalog";

/** Image-first tile. Clicking opens the detail window. */
export function ProductCard({ p, onOpen, priority }: { p: PublicProduct; onOpen: () => void; priority?: boolean }) {
  const second = p.images[1];
  return (
    <button type="button" onClick={onOpen} className="group relative block aspect-[4/5] w-full overflow-hidden rounded-[1.4rem] border border-white/[0.07] bg-surface text-left transition-[border-color,transform] duration-300 hover:border-white/20 active:scale-[0.99]" aria-label={`View ${p.name}, ${formatINR(p.pricePaise)}`} aria-haspopup="dialog">
      {p.images[0] ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.images[0]} alt={p.name} loading={priority ? "eager" : "lazy"} className={`absolute inset-0 h-full w-full object-cover transition duration-700 ease-out ${second ? "group-hover:opacity-0" : "group-hover:scale-[1.06]"}`} />
      ) : (
        <div className="grain absolute inset-0 flex items-center justify-center font-display text-5xl font-bold text-fg/10">{p.name.slice(0, 1)}</div>
      )}
      {second && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={second} alt="" loading="lazy" className="absolute inset-0 h-full w-full scale-105 object-cover opacity-0 transition duration-700 ease-out group-hover:scale-100 group-hover:opacity-100" />
      )}

      {p.brand && <span className="absolute top-3 left-3 rounded-full bg-bg/60 px-2.5 py-1 text-[10px] font-medium tracking-[0.14em] text-fg/90 uppercase backdrop-blur-md">{p.brand}</span>}
      {p.condition !== "new" && <span className="absolute top-3 right-3 rounded-full bg-accent px-2.5 py-1 text-[10px] font-semibold tracking-wide text-black capitalize">{p.condition}</span>}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pt-14 pb-4">
        <div className="hidden max-h-0 overflow-hidden text-[11px] text-fg/70 opacity-0 transition-all duration-300 group-hover:mb-2 group-hover:max-h-5 group-hover:opacity-100 md:block">
          {p.sizes.slice(0, 6).join(" · ")}
          {p.sizes.length > 6 ? ` +${p.sizes.length - 6}` : ""}
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="font-display line-clamp-2 text-[15px] leading-tight font-semibold tracking-tight">{p.name}</div>
          <div className="num shrink-0 rounded-full bg-white/10 px-3 py-1 text-[13px] font-semibold backdrop-blur-md">{formatINR(p.pricePaise)}</div>
        </div>
      </div>
    </button>
  );
}
