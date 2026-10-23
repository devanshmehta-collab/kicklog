import { FileText } from "lucide-react";
import { cn } from "@/lib/utils";

/** Opens the printable customer invoice for a sale in a new tab. */
export function InvoiceButton({ saleId, label = "Get invoice", className }: { saleId: string; label?: string; className?: string }) {
  return (
    <a
      href={`/invoice/${saleId}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Get invoice"
      title="Get a customer invoice (print or save as PDF)"
      className={cn("inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-muted transition-colors hover:bg-raised hover:text-fg", className)}
    >
      <FileText size={14} /> {label}
    </a>
  );
}
