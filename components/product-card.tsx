import { formatINR } from "@/lib/money";
import type { PublicProduct } from "@/lib/services/catalog";

/** Product tile. Clicking opens the detail window. */
export function ProductCard({ p, onOpen, priority }: { p: PublicProduct; onOpen: () => void; priority?: boolean }) {
  const second = p.images[1];
  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left" aria-label={`View ${p.name}, ${formatINR(p.pricePaise)}`} aria-haspopup="dialog">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-line bg-surface">
        {p.images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.images[0]} alt={p.name} loading={priority ? "eager" : "lazy"} className={`absolute inset-0 h-full w-full object-cover transition duration-500 ${second ? "group-hover:opacity-0" : "group-hover:scale-[1.04]"}`} />
        ) : (
          <div className="grain absolute inset-0 flex items-center justify-center text-xs tracking-widest text-muted uppercase">Photo soon</div>
        )}
        {second && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={second} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-0 transition duration-500 group-hover:opacity-100" />
        )}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3 px-0.5">
        <div className="line-clamp-1 text-sm font-medium">{p.name}</div>
        <div className="num shrink-0 text-sm font-semibold">{formatINR(p.pricePaise)}</div>
      </div>
    </button>
  );
}
