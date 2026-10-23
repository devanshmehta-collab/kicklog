import { eq } from "drizzle-orm";
import type { DB } from "../db";
import { customers, productVariants, products, refunds, saleItems, sales } from "../db/schema";
import { notFound } from "../errors";
import { getSettings } from "./settings";

/**
 * Everything printed on a customer invoice. This is a CUSTOMER-FACING document, so it is built from an explicit
 * list of fields: what the buyer paid, never what the goods cost, the seller's fees or the profit.
 */
export interface Invoice {
  number: string;
  date: string;
  seller: { name: string; phone: string; address: string; gstin: string; note: string };
  buyer: { name: string; phone: string; city: string; instagram: string };
  lines: { description: string; size: string; quantity: number; unitPricePaise: number; totalPaise: number; refundedQuantity: number }[];
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
  refundedPaise: number;
  netPaidPaise: number;
}

/** "919059312317" → "+91 90593 12317". Anything unrecognised is returned unchanged. */
export function prettyPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
  return raw;
}

export const invoiceNumber = (seq: number | null | undefined) => `INV-${String(seq ?? 0).padStart(4, "0")}`;

export async function getInvoice(db: DB, saleId: string): Promise<Invoice> {
  const [row] = await db
    .select({ sale: sales, customer: customers })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(eq(sales.id, saleId));
  if (!row) throw notFound("Sale not found");
  const { sale, customer } = row;

  const items = await db
    .select({
      quantity: saleItems.quantity,
      unitPricePaise: saleItems.unitPricePaise,
      refundedQuantity: saleItems.refundedQuantity,
      name: products.name,
      size: productVariants.size,
    })
    .from(saleItems)
    .innerJoin(productVariants, eq(productVariants.id, saleItems.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(saleItems.saleId, saleId));

  // A sale drawn from several batches has one row per batch: show each product/size/price once.
  const merged = new Map<string, Invoice["lines"][number]>();
  for (const it of items) {
    const k = `${it.name}|${it.size}|${it.unitPricePaise}`;
    const cur = merged.get(k);
    if (cur) {
      cur.quantity += it.quantity;
      cur.refundedQuantity += it.refundedQuantity;
      cur.totalPaise += it.quantity * it.unitPricePaise;
    } else {
      merged.set(k, { description: it.name, size: it.size, quantity: it.quantity, unitPricePaise: it.unitPricePaise, totalPaise: it.quantity * it.unitPricePaise, refundedQuantity: it.refundedQuantity });
    }
  }

  const refunded = (await db.select().from(refunds).where(eq(refunds.saleId, saleId))).reduce((a, r) => a + r.refundAmountPaise, 0);
  const settings = await getSettings(db);

  return {
    number: invoiceNumber(sale.invoiceSeq),
    date: sale.saleDate.toISOString(),
    seller: { name: settings.businessName, phone: prettyPhone(settings.phone || settings.whatsappNumber), address: settings.address, gstin: settings.gstin, note: settings.invoiceNote },
    buyer: { name: customer?.name ?? "", phone: customer?.phone ?? "", city: customer?.city ?? "", instagram: customer?.instagram ?? "" },
    lines: [...merged.values()],
    subtotalPaise: sale.grossRevenuePaise,
    discountPaise: sale.discountPaise,
    shippingPaise: sale.shippingRevenuePaise,
    totalPaise: sale.netProceedsPaise,
    refundedPaise: refunded,
    netPaidPaise: sale.netProceedsPaise - refunded,
  };
}
