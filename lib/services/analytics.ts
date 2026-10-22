import { sql } from "drizzle-orm";
import type { DB } from "../db";
import { getSettings } from "./settings";
import { listStock } from "./inventory";

type Row = Record<string, unknown>;
const rows = async (db: DB, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Row[];
const n = (v: unknown) => Number(v ?? 0);

export interface Range {
  from?: Date;
  to?: Date;
}

/**
 * Everything on the dashboard is computed in PostgreSQL from the ledger tables.
 * Realised numbers are net of refunds; projected resale value is reported separately and never mixed in.
 *
 *   revenue = Σ sale net proceeds − Σ refunds
 *   COGS    = Σ sale COGS − Σ COGS restored on restocked refunds
 *   net profit = revenue − COGS − selling expenses
 */
export async function summary(db: DB, range: Range = {}) {
  const from = range.from ?? new Date(0);
  const to = range.to ?? new Date("2999-01-01");
  const settings = await getSettings(db);

  const [s] = await rows(
    db,
    sql`select coalesce(sum(net_proceeds_paise),0)::float8 as revenue, coalesce(sum(cogs_paise),0)::float8 as cogs,
        coalesce(sum(shipping_cost_paise + fees_paise + other_expenses_paise),0)::float8 as expenses,
        coalesce(sum(profit_paise),0)::float8 as profit, count(*)::int as orders
        from sales where sale_date >= ${from} and sale_date <= ${to}`,
  );
  const [r] = await rows(
    db,
    sql`select coalesce(sum(rf.refund_amount_paise),0)::float8 as refunded, coalesce(sum(rf.cogs_restored_paise),0)::float8 as restored,
        coalesce(sum(rf.profit_delta_paise),0)::float8 as delta
        from refunds rf join sales sa on sa.id = rf.sale_id where sa.sale_date >= ${from} and sa.sale_date <= ${to}`,
  );
  const [u] = await rows(
    db,
    sql`select coalesce(sum(si.quantity - si.refunded_quantity),0)::int as sold
        from sale_items si join sales sa on sa.id = si.sale_id where sa.sale_date >= ${from} and sa.sale_date <= ${to}`,
  );
  const [inv] = await rows(
    db,
    sql`select coalesce(sum(l.quantity_remaining),0)::int as units,
        coalesce(sum(l.quantity_remaining * l.unit_cost_paise),0)::float8 as cost,
        coalesce(sum(l.quantity_remaining * coalesce(p.public_price_paise, 0)),0)::float8 as potential
        from inventory_lots l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id`,
  );
  const [cap] = await rows(db, sql`select coalesce(sum(quantity_acquired * unit_cost_paise),0)::float8 as invested from inventory_lots`);
  const [ps] = await rows(
    db,
    sql`select coalesce(sum(a.profit_paise),0)::float8 as partner_profit from lot_profit_allocations a
        join sales sa on sa.id = a.sale_id where a.partner_id is not null and sa.sale_date >= ${from} and sa.sale_date <= ${to}`,
  );

  const revenue = n(s.revenue) - n(r.refunded);
  const cogs = n(s.cogs) - n(r.restored);
  const netProfit = n(s.profit) + n(r.delta);
  const grossProfit = revenue - cogs;

  const bucket = (range.to && range.from && range.to.getTime() - range.from.getTime() > 120 * 86400_000) || !range.from ? "month" : "day";
  const fmt = bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD";
  const trendRaw = await rows(
    db,
    sql`select b as bucket, sum(rev)::float8 as revenue, sum(prof)::float8 as profit from (
          select to_char(sale_date, ${fmt}) as b, net_proceeds_paise as rev, profit_paise as prof from sales where sale_date >= ${from} and sale_date <= ${to}
          union all
          select to_char(sa.sale_date, ${fmt}), -rf.refund_amount_paise, rf.profit_delta_paise
          from refunds rf join sales sa on sa.id = rf.sale_id where sa.sale_date >= ${from} and sa.sale_date <= ${to}
        ) t group by b order by b`,
  );

  const byCategory = await rows(
    db,
    sql`select p.category as name, sum(si.quantity - si.refunded_quantity)::int as units,
        sum(si.unit_price_paise * (si.quantity - si.refunded_quantity))::float8 as revenue
        from sale_items si join sales sa on sa.id = si.sale_id join product_variants v on v.id = si.variant_id join products p on p.id = v.product_id
        where sa.sale_date >= ${from} and sa.sale_date <= ${to} group by p.category order by revenue desc`,
  );
  const byBrand = await rows(
    db,
    sql`select coalesce(p.brand, 'Unbranded') as name, sum(si.quantity - si.refunded_quantity)::int as units,
        sum(si.unit_price_paise * (si.quantity - si.refunded_quantity))::float8 as revenue
        from sale_items si join sales sa on sa.id = si.sale_id join product_variants v on v.id = si.variant_id join products p on p.id = v.product_id
        where sa.sale_date >= ${from} and sa.sale_date <= ${to} group by 1 order by revenue desc limit 10`,
  );
  const byType = await rows(
    db,
    sql`select coalesce(c.type::text, 'D2C') as name, count(*)::int as orders, sum(sa.net_proceeds_paise)::float8 as revenue
        from sales sa left join customers c on c.id = sa.customer_id where sa.sale_date >= ${from} and sa.sale_date <= ${to} group by 1`,
  );
  const purchases = await rows(
    db,
    sql`select to_char(purchase_date, 'YYYY-MM') as month, sum(quantity_acquired * unit_cost_paise)::float8 as spend
        from inventory_lots where purchase_date >= ${from} and purchase_date <= ${to} group by 1 order by 1`,
  );
  const composition = await rows(
    db,
    sql`select p.category as name, sum(l.quantity_remaining)::int as units, sum(l.quantity_remaining * l.unit_cost_paise)::float8 as value
        from inventory_lots l join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
        where l.quantity_remaining > 0 group by 1 order by value desc`,
  );
  const [rep] = await rows(
    db,
    sql`select count(*) filter (where o = 1)::int as one_time, count(*) filter (where o > 1)::int as repeat
        from (select customer_id, count(*) as o from sales where customer_id is not null and sale_date >= ${from} and sale_date <= ${to} group by 1) t`,
  );

  const stock = await listStock(db);
  const now = Date.now();
  const slow = stock
    .filter((x) => x.oldestPurchase && (now - x.oldestPurchase.getTime()) / 86400_000 >= settings.slowMovingDays)
    .map((x) => ({ variantId: x.variantId, name: x.name, size: x.size, quantity: x.quantity, days: Math.floor((now - x.oldestPurchase!.getTime()) / 86400_000), costValuePaise: x.costValuePaise }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 10);
  const soldVariants = new Set(
    (await rows(db, sql`select distinct variant_id from sale_items`)).map((x) => String(x.variant_id)),
  );
  const low = stock
    .filter((x) => x.quantity <= settings.lowStockThreshold && soldVariants.has(x.variantId))
    .map((x) => ({ variantId: x.variantId, name: x.name, size: x.size, quantity: x.quantity }));

  return {
    kpis: {
      realizedRevenuePaise: revenue,
      cogsPaise: cogs,
      sellingExpensesPaise: n(s.expenses),
      realizedGrossProfitPaise: grossProfit,
      realizedNetProfitPaise: netProfit,
      grossMarginPct: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      netMarginPct: revenue > 0 ? (netProfit / revenue) * 100 : 0,
      orders: n(s.orders),
      unitsSold: n(u.sold),
      refundedPaise: n(r.refunded),
      unitsInStock: n(inv.units),
      inventoryCostValuePaise: n(inv.cost),
      potentialResaleValuePaise: n(inv.potential),
      capitalInvestedPaise: n(cap.invested),
      partnerProfitSharePaise: n(ps.partner_profit),
    },
    trend: trendRaw.map((t) => ({ bucket: String(t.bucket), revenue: n(t.revenue), profit: n(t.profit) })),
    byCategory: byCategory.map((x) => ({ name: String(x.name), units: n(x.units), revenue: n(x.revenue) })),
    byBrand: byBrand.map((x) => ({ name: String(x.name), units: n(x.units), revenue: n(x.revenue) })),
    byCustomerType: byType.map((x) => ({ name: String(x.name), orders: n(x.orders), revenue: n(x.revenue) })),
    purchaseSpend: purchases.map((x) => ({ month: String(x.month), spend: n(x.spend) })),
    composition: composition.map((x) => ({ name: String(x.name), units: n(x.units), value: n(x.value) })),
    repeatCustomers: { oneTime: n(rep?.one_time), repeat: n(rep?.repeat) },
    slowMoving: slow,
    lowStock: low,
  };
}

export async function recentActivity(db: DB, limit = 12) {
  const res = await rows(
    db,
    sql`select * from (
        select 'sale' as kind, sa.created_at as at, 'Sold ' || coalesce(string_agg(distinct p.name, ', '), 'item') as text, sa.profit_paise::float8 as amount
          from sales sa join sale_items si on si.sale_id = sa.id join product_variants v on v.id = si.variant_id join products p on p.id = v.product_id group by sa.id
        union all
        select 'purchase', pt.created_at, 'Bought ' || p.name || ' (' || v.size || ')', pt.total_cost_paise::float8
          from purchase_transactions pt join inventory_lots l on l.id = pt.lot_id join product_variants v on v.id = l.variant_id join products p on p.id = v.product_id
        union all
        select 'refund', rf.created_at, 'Refund issued', rf.refund_amount_paise::float8 from refunds rf
      ) t order by at desc limit ${limit}`,
  );
  return res.map((r) => ({ kind: String(r.kind), at: new Date(r.at as string).toISOString(), text: String(r.text), amountPaise: n(r.amount) }));
}
