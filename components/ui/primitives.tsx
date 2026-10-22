"use client";

import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-[0_1px_0_0_rgb(255_255_255/0.03)_inset]", className)} {...p} />;
}

export function CardHeader({ title, action, className }: { title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <h2 className="text-[11px] font-medium tracking-[0.16em] text-muted uppercase">{title}</h2>
      {action}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn("h-10 w-full rounded-xl border border-line bg-raised px-3 text-sm placeholder:text-muted/70 focus:border-fg/50", className)}
    {...p}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn("w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-sm placeholder:text-muted/70 focus:border-fg/50", className)}
    {...p}
  />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...p }, ref) => (
  <select ref={ref} className={cn("h-10 w-full rounded-xl border border-line bg-raised px-3 text-sm focus:border-fg/50", className)} {...p} />
));
Select.displayName = "Select";

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-muted/70">{hint}</span>}
      {error && <span className="block text-xs text-loss">{error}</span>}
    </label>
  );
}

const tones = {
  neutral: "bg-raised text-muted border-line",
  gain: "bg-gain/10 text-gain border-gain/30",
  loss: "bg-loss/10 text-loss border-loss/30",
  review: "bg-review/10 text-review border-review/30",
} as const;

export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />;
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-line bg-surface sm:rounded-2xl scroll-thin", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1 text-muted hover:bg-raised hover:text-fg">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-xl border border-line bg-raised p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn("rounded-lg px-3 py-1.5 text-sm transition-colors", value === t.id ? "bg-bg text-fg" : "text-muted hover:text-fg")}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto scroll-thin", className)}>
      <table className="w-full min-w-[560px] text-sm [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-raised/40 [&_thead_tr]:bg-raised/30">{children}</table>
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn("px-4 py-2.5 text-left text-xs font-medium tracking-wide text-muted uppercase whitespace-nowrap", className)} {...p} />
);
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn("px-4 py-3 align-middle border-t border-line", className)} {...p} />;

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Money({ paise, signed, className }: { paise: number | null | undefined; signed?: boolean; className?: string }) {
  if (paise == null) return <span className="text-muted">—</span>;
  const abs = Math.abs(paise);
  const str = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: abs % 100 === 0 ? 0 : 2 }).format(abs / 100);
  const sign = paise < 0 ? "−" : signed && paise > 0 ? "+" : "";
  return <span className={cn("num", signed && paise > 0 && "text-gain", paise < 0 && "text-loss", className)}>{sign}{str}</span>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} aria-label="Loading" />;
}
