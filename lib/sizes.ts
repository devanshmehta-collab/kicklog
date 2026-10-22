/** Size presets for the size picker. Sizes are stored as free text; the picker just makes the common ones one tap. */

export type SizeSystem = "plain" | "UK" | "US" | "EU";
export const SIZE_SYSTEMS: { id: SizeSystem; label: string }[] = [
  { id: "plain", label: "Plain (10, 10.5…)" },
  { id: "UK", label: "UK" },
  { id: "US", label: "US" },
  { id: "EU", label: "EU" },
];

const range = (from: number, to: number, step = 0.5) => {
  const out: number[] = [];
  for (let n = from; n <= to + 1e-9; n += step) out.push(Math.round(n * 10) / 10);
  return out;
};

const APPAREL = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"];
const WATCH_MM = [34, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46].map((n) => `${n}mm`);

export type SizeKind = "footwear" | "apparel" | "watch" | "onesize";

export function sizeKind(category: string | null | undefined): SizeKind {
  const c = (category ?? "").toLowerCase();
  if (/sneak|shoe|footwear|boot|trainer/.test(c)) return "footwear";
  if (/apparel|cloth|hood|tee|shirt|jacket|jersey|pant|jean|sweat/.test(c)) return "apparel";
  if (/watch/.test(c)) return "watch";
  return "onesize";
}

const prefix = (system: SizeSystem, n: number | string) => (system === "plain" ? String(n) : `${system} ${n}`);

export function presetSizes(category: string | null | undefined, system: SizeSystem = "plain"): string[] {
  switch (sizeKind(category)) {
    case "footwear": {
      const r = system === "EU" ? range(35, 48) : system === "UK" ? range(3, 14) : range(4, 15);
      return r.map((n) => prefix(system, n));
    }
    case "apparel":
      return APPAREL;
    case "watch":
      return WATCH_MM;
    default:
      return ["OS"];
  }
}

/** Sort sizes naturally: apparel by S<M<L, numbers by value (ignoring a UK/US/EU prefix), the rest alphabetically. */
export function sortSizes(sizes: string[]): string[] {
  const key = (s: string): [number, number | string] => {
    const a = APPAREL.indexOf(s.toUpperCase());
    if (a >= 0) return [0, a];
    const m = s.match(/(\d+(?:\.\d+)?)/);
    if (m) return [1, parseFloat(m[1])];
    return [2, s.toLowerCase()];
  };
  return [...sizes].sort((x, y) => {
    const [ax, bx] = key(x);
    const [ay, by] = key(y);
    if (ax !== ay) return ax - ay;
    return typeof bx === "number" && typeof by === "number" ? bx - by : String(bx).localeCompare(String(by));
  });
}

/** Clean a typed size ("uk 9", " 10.5 ", "m") into the stored label. */
export function normalizeCustomSize(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  if (!t) return "";
  const m = t.match(/^(uk|us|eu)\s*(.+)$/i);
  if (m) return `${m[1].toUpperCase()} ${m[2]}`;
  if (APPAREL.includes(t.toUpperCase())) return t.toUpperCase();
  if (/^os$/i.test(t) || /^one ?size$/i.test(t)) return "OS";
  return t;
}
