import { Sparkle } from "lucide-react";

/** Endless ticker of the brands currently in stock (nothing is shown unless there are at least two). */
export function BrandMarquee({ brands }: { brands: string[] }) {
  if (brands.length < 2) return null;
  // repeat until one run is wide enough, then twice so the -50% loop is seamless
  const run = Array.from({ length: Math.max(1, Math.ceil(8 / brands.length)) }, () => brands).flat();
  return (
    <div className="marquee overflow-hidden border-y border-line/70 py-5" aria-hidden>
      <div className="marquee-track">
        {[0, 1].map((k) => (
          <div key={k} className="flex shrink-0 items-center">
            {run.map((b, idx) => (
              <span key={`${k}-${idx}`} className="flex items-center">
                <span className="outline-text font-display px-8 text-5xl font-bold tracking-tight uppercase sm:text-6xl">{b}</span>
                <Sparkle size={18} className="text-accent" />
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
