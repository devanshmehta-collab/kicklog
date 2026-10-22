import { randomUUID } from "node:crypto";
import { z } from "zod";
import { api } from "@/lib/api";
import { READ, WRITE } from "@/lib/auth";
import { paise } from "@/lib/schemas";
import { listSales, recordSale } from "@/lib/services/sales";

export const GET = api({ roles: READ }, async ({ db, query }) => {
  const from = query.get("from");
  const to = query.get("to");
  return listSales(db, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    customerId: query.get("customerId") ?? undefined,
  });
});

const Body = z.object({
  idempotencyKey: z.string().min(8).max(100).default(() => `sale:${randomUUID()}`),
  lines: z
    .array(z.object({ variantId: z.string().uuid(), lotId: z.string().uuid().optional(), quantity: z.number().int().min(1).max(10000), unitPricePaise: paise }))
    .min(1)
    .max(30),
  customer: z
    .object({
      id: z.string().uuid().optional(),
      name: z.string().trim().max(120).optional(),
      phone: z.string().trim().max(30).nullish(),
      instagram: z.string().trim().max(60).nullish(),
      city: z.string().trim().max(80).nullish(),
      type: z.enum(["D2C", "B2B"]).optional(),
    })
    .nullish(),
  channel: z.string().trim().max(40).default("whatsapp"),
  saleDate: z.string().datetime().optional(),
  costs: z
    .object({ discountPaise: paise.optional(), shippingRevenuePaise: paise.optional(), shippingCostPaise: paise.optional(), feesPaise: paise.optional(), otherExpensesPaise: paise.optional() })
    .optional(),
  expenses: z.array(z.object({ label: z.string().trim().min(1).max(80), amountPaise: paise })).max(10).optional(),
  notes: z.string().trim().max(1000).nullish(),
});

/** Manual sale form — same atomic service the AI Quick Log uses. */
export const POST = api({ roles: WRITE, body: Body }, async ({ db, body, user }) =>
  recordSale(db, { ...body, saleDate: body.saleDate ? new Date(body.saleDate) : undefined, source: "manual", createdBy: user.id }),
);
