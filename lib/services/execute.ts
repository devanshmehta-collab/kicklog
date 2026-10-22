import type { DB } from "../db";
import type { PurchaseAction, SaleAction, StockCandidate } from "../rules";
import { createPurchase, listStock } from "./inventory";
import { recordSale } from "./sales";

export async function loadStockCandidates(db: DB): Promise<StockCandidate[]> {
  const rows = await listStock(db);
  return rows.map((r) => ({
    variantId: r.variantId,
    name: r.name,
    brand: r.brand,
    size: r.size,
    quantity: r.quantity,
    colorway: r.colorway,
    sku: r.sku,
  }));
}

export interface ExecMeta {
  idempotencyKey: string;
  aiRequestId?: string | null;
  reviewId?: string | null;
  userId?: string | null;
}

export type ExecResult =
  | { kind: "purchase"; id: string; variantId: string; unitCostPaise: number; duplicate: boolean }
  | { kind: "sale"; id: string; profitPaise: number; netProceedsPaise: number; duplicate: boolean };

/** Run a validated action through the same shared services used by the manual forms. */
export async function executeAction(db: DB, action: PurchaseAction | SaleAction, meta: ExecMeta): Promise<ExecResult> {
  if (action.kind === "purchase") {
    const r = await createPurchase(db, {
      idempotencyKey: meta.idempotencyKey,
      product: { ...action.product },
      size: action.size,
      quantity: action.quantity,
      totalCostPaise: action.totalCostPaise,
      shippingPaise: action.shippingPaise,
      purchaseDate: action.purchaseDate ?? undefined,
      source: "ai",
      aiRequestId: meta.aiRequestId,
      reviewId: meta.reviewId,
      createdBy: meta.userId,
    });
    return { kind: "purchase", id: r.lotId, variantId: r.variantId, unitCostPaise: r.unitCostPaise, duplicate: r.duplicate };
  }
  const r = await recordSale(db, {
    idempotencyKey: meta.idempotencyKey,
    lines: [{ variantId: action.variantId, quantity: action.quantity, unitPricePaise: action.unitPricePaise }],
    costs: { shippingCostPaise: action.shippingCostPaise, feesPaise: action.feesPaise },
    customer: action.customerName ? { name: action.customerName } : null,
    saleDate: action.saleDate ?? undefined,
    source: "ai",
    aiRequestId: meta.aiRequestId,
    reviewId: meta.reviewId,
    createdBy: meta.userId,
  });
  return { kind: "sale", id: r.saleId, profitPaise: r.profitPaise, netProceedsPaise: r.netProceedsPaise, duplicate: r.duplicate };
}
