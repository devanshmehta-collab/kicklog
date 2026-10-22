import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { customers } from "../db/schema";
import { notFound } from "../errors";
import { audit } from "./audit";

export const CustomerInput = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  instagram: z.string().trim().max(60).nullish(),
  email: z.string().trim().email().max(200).nullish().or(z.literal("")),
  city: z.string().trim().max(80).nullish(),
  type: z.enum(["D2C", "B2B"]).default("D2C"),
  notes: z.string().trim().max(2000).nullish(),
});
export type CustomerInputT = z.infer<typeof CustomerInput>;

const clean = (c: Partial<CustomerInputT>) => ({ ...c, email: c.email || null });

export async function createCustomer(db: DB, input: CustomerInputT, userId?: string) {
  const [row] = await db.insert(customers).values(clean(input) as typeof customers.$inferInsert).returning();
  await audit(db, { userId, action: "customer.create", entity: "customer", entityId: row.id });
  return row;
}

export async function updateCustomer(db: DB, id: string, input: Partial<CustomerInputT>, userId?: string) {
  const [row] = await db.update(customers).set(clean(input)).where(eq(customers.id, id)).returning();
  if (!row) throw notFound("Customer not found");
  await audit(db, { userId, action: "customer.update", entity: "customer", entityId: id });
  return row;
}

/** Customer list with spend stats. Spend is net of refunds. */
export async function listCustomers(db: DB, q?: string) {
  const like = q ? `%${q.replace(/[%_]/g, "")}%` : null;
  const res = await db.execute(sql`
    select c.id, c.name, c.phone, c.instagram, c.email, c.city, c.type, c.notes, c.created_at as "createdAt",
      coalesce(s.orders, 0)::int as orders,
      (coalesce(s.spend, 0) - coalesce(r.refunded, 0))::float8 as "lifetimeSpendPaise",
      s.last_purchase as "lastPurchase"
    from customers c
    left join (
      select customer_id, count(*) as orders, sum(net_proceeds_paise) as spend, max(sale_date) as last_purchase
      from sales group by customer_id
    ) s on s.customer_id = c.id
    left join (
      select sa.customer_id, sum(rf.refund_amount_paise) as refunded
      from refunds rf join sales sa on sa.id = rf.sale_id group by sa.customer_id
    ) r on r.customer_id = c.id
    where ${like ? sql`(c.name ilike ${like} or c.phone ilike ${like} or c.instagram ilike ${like})` : sql`true`}
    order by s.last_purchase desc nulls last, c.created_at desc
    limit 500
  `);
  return (res.rows as Record<string, unknown>[]).map((r) => {
    const orders = Number(r.orders);
    const spend = Number(r.lifetimeSpendPaise);
    return {
      ...r,
      orders,
      lifetimeSpendPaise: spend,
      repeatPurchases: Math.max(0, orders - 1),
      avgOrderValuePaise: orders ? Math.round(spend / orders) : 0,
    } as {
      id: string; name: string; phone: string | null; instagram: string | null; email: string | null; city: string | null;
      type: "D2C" | "B2B"; notes: string | null; orders: number; lifetimeSpendPaise: number; lastPurchase: string | null;
      repeatPurchases: number; avgOrderValuePaise: number;
    };
  });
}

export async function getCustomer(db: DB, id: string) {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  if (!row) throw notFound("Customer not found");
  return row;
}

export const recentCustomers = (db: DB) => db.select().from(customers).orderBy(desc(customers.createdAt)).limit(20);
