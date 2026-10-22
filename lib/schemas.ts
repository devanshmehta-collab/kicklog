import { z } from "zod";
import { computeLandedCost } from "./profit";
import type { PurchaseInput, ProductFields } from "./services/inventory";

export const paise = z.number().int().nonnegative().max(1e13);
export const bps = z.number().int().min(0).max(10000);

export const LandedSchema = z.object({
  countryOfOrigin: z.string().max(80).nullish(),
  foreignCurrency: z.string().max(8).nullish(),
  /** per-unit supplier price in minor units of the foreign currency (cents) */
  foreignUnitPriceMinor: z.number().int().nonnegative().nullish(),
  fxRate: z.number().positive().nullish(),
  inrUnitPricePaise: paise.nullish(),
  internationalShippingPaise: paise.nullish(),
  customsDutyPaise: paise.nullish(),
  paymentFeesPaise: paise.nullish(),
  domesticShippingPaise: paise.nullish(),
  invoiceIncludes: z
    .object({
      internationalShipping: z.boolean().optional(),
      customsDuty: z.boolean().optional(),
      paymentFees: z.boolean().optional(),
      domesticShipping: z.boolean().optional(),
    })
    .optional(),
});

export const LotInput = z
  .object({
    size: z.string().trim().min(1).max(30).default("OS"),
    quantity: z.number().int().min(1).max(10000),
    unitCostPaise: paise.optional(),
    landed: LandedSchema.optional(),
    supplierId: z.string().uuid().nullish(),
    purchaseDate: z.string().datetime().optional(),
    partners: z.array(z.object({ partnerId: z.string().uuid(), ownershipBps: bps, profitShareBps: bps })).max(10).optional(),
    notes: z.string().max(500).nullish(),
  })
  .refine((x) => x.unitCostPaise != null || x.landed, { message: "Provide a unit cost or a landed-cost breakdown" });
export type LotInputT = z.infer<typeof LotInput>;

export function lotToPurchase(lot: LotInputT, product: ProductFields, key: string, userId: string): PurchaseInput {
  let total: number;
  let landed: PurchaseInput["landed"];
  if (lot.landed) {
    const l = lot.landed;
    const c = computeLandedCost({
      foreignUnitPriceMinor: l.foreignUnitPriceMinor ?? undefined,
      fxRate: l.fxRate ?? undefined,
      inrUnitPricePaise: l.inrUnitPricePaise ?? undefined,
      quantity: lot.quantity,
      internationalShippingPaise: l.internationalShippingPaise ?? 0,
      customsDutyPaise: l.customsDutyPaise ?? 0,
      paymentFeesPaise: l.paymentFeesPaise ?? 0,
      domesticShippingPaise: l.domesticShippingPaise ?? 0,
      invoiceIncludes: l.invoiceIncludes,
    });
    total = c.totalLandedPaise;
    landed = {
      countryOfOrigin: l.countryOfOrigin,
      foreignCurrency: l.foreignCurrency,
      foreignUnitPriceMinor: l.foreignUnitPriceMinor,
      fxRate: l.fxRate,
      internationalShippingPaise: l.internationalShippingPaise,
      customsDutyPaise: l.customsDutyPaise,
      paymentFeesPaise: l.paymentFeesPaise,
      domesticShippingPaise: l.domesticShippingPaise,
    };
  } else {
    total = lot.unitCostPaise! * lot.quantity;
  }
  return {
    idempotencyKey: key,
    product,
    size: lot.size,
    quantity: lot.quantity,
    totalCostPaise: total,
    supplierId: lot.supplierId,
    purchaseDate: lot.purchaseDate ? new Date(lot.purchaseDate) : undefined,
    landed,
    partners: lot.partners,
    source: "manual",
    createdBy: userId,
    notes: lot.notes,
  };
}
