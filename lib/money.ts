/** Currency helpers. Money is always carried as integer paise inside the backend. */

export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const inrWhole = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** Format paise as ₹1,23,456 (drops ".00"). */
export function formatINR(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return paise % 100 === 0 ? inrWhole.format(paise / 100) : inr.format(paise / 100);
}

/** Parse a user-entered rupee amount ("18,000", "₹1.2L", "15k") into paise. Returns null when not parseable. */
export function parseRupeesToPaise(input: string): number | null {
  const s = input.toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, "");
  const m = s.match(/^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore)?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult: Record<string, number> = { k: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, cr: 1e7, crore: 1e7 };
  return rupeesToPaise(n * (mult[m[2] ?? ""] ?? 1));
}
