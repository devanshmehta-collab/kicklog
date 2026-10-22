import { z } from "zod";

/**
 * Structured output we require from Claude. Validated with Zod on the server —
 * the model's shape is never trusted on its own.
 */
const num = z.number().finite().nullish();
const str = z.string().max(300).nullish();

export const PurchaseFieldsSchema = z.object({
  item: str,
  brand: str,
  category: str,
  size: str,
  condition: str,
  colorway: str,
  quantity: num,
  /** Amount the user quoted for the goods, in INR. See amount_basis. */
  cost_inr: num,
  /** Is cost_inr per unit or for the whole quantity? */
  amount_basis: z.enum(["per_unit", "total"]).nullish(),
  shipping_inr: num,
  cost_includes_shipping: z.boolean().nullish(),
  purchase_date: str,
});

export const SaleFieldsSchema = z.object({
  matched_item_id: str,
  other_possible_ids: z.array(z.string()).nullish(),
  quantity: num,
  price_inr: num,
  price_basis: z.enum(["per_unit", "total"]).nullish(),
  /** Outbound shipping the seller paid. */
  shipping_inr: num,
  fees_inr: num,
  sale_date: str,
  customer_name: str,
});

export const InterpretationSchema = z.object({
  type: z.enum(["purchase", "sale", "unclear"]),
  purchase: PurchaseFieldsSchema.nullish(),
  sale: SaleFieldsSchema.nullish(),
  confidence: z.number().min(0).max(1),
  questions: z.array(z.string()).default([]),
  /** false when attached images are blurry / unreadable. */
  image_readable: z.boolean().nullish(),
});

export type Interpretation = z.infer<typeof InterpretationSchema>;
export type PurchaseFields = z.infer<typeof PurchaseFieldsSchema>;
export type SaleFields = z.infer<typeof SaleFieldsSchema>;

/** What the review queue stores / the edit form submits (confidence is irrelevant once a human confirms). */
export const ReviewFieldsSchema = z.object({
  type: z.enum(["purchase", "sale", "unclear"]),
  purchase: PurchaseFieldsSchema.nullish(),
  sale: SaleFieldsSchema.nullish(),
});
export type ReviewFields = z.infer<typeof ReviewFieldsSchema>;

/** JSON Schema handed to Claude as the tool's input_schema. */
export function interpretationJsonSchema(): Record<string, unknown> {
  const js = z.toJSONSchema(InterpretationSchema, { io: "input" }) as Record<string, unknown>;
  delete js.$schema;
  return js;
}
