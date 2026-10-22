import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "../db";
import { capitalContributions, lotOwnershipAllocations, partnerDistributions, partners } from "../db/schema";
import { badRequest, notFound } from "../errors";
import { audit } from "./audit";
import { validatePartnerShares } from "./inventory";

export const PartnerInput = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

export async function createPartner(db: DB, input: z.infer<typeof PartnerInput>, userId?: string) {
  const [row] = await db.insert(partners).values(input).returning();
  await audit(db, { userId, action: "partner.create", entity: "partner", entityId: row.id });
  return row;
}

export async function addContribution(db: DB, partnerId: string, amountPaise: number, note?: string | null, userId?: string) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw badRequest("Contribution must be a positive amount");
  const [p] = await db.select().from(partners).where(eq(partners.id, partnerId));
  if (!p) throw notFound("Partner not found");
  const [row] = await db.insert(capitalContributions).values({ partnerId, amountPaise, note: note ?? null }).returning();
  await audit(db, { userId, action: "partner.contribution", entity: "partner", entityId: partnerId, detail: { amountPaise } });
  return row;
}

export interface LedgerRow {
  partnerId: string | null;
  name: string;
  capitalContributedPaise: number;
  /** Cost basis of lots this partner co-owns (ownership % × lot cost). */
  capitalDeployedPaise: number;
  profitAllocatedPaise: number;
  distributedPaise: number;
  pendingPayoutPaise: number;
}

/** Record an actual cash distribution. Cannot exceed what is currently owed. */
export async function addDistribution(db: DB, partnerId: string, amountPaise: number, note?: string | null, userId?: string) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw badRequest("Distribution must be a positive amount");
  return db.transaction(async (tx) => {
    await tx.select().from(partners).where(eq(partners.id, partnerId)).for("update");
    const [row] = (await partnerLedger(tx, partnerId)).filter((r) => r.partnerId === partnerId);
    if (!row) throw notFound("Partner not found");
    if (amountPaise > row.pendingPayoutPaise) throw badRequest("Distribution exceeds the pending payout for this partner");
    const [d] = await tx.insert(partnerDistributions).values({ partnerId, amountPaise, note: note ?? null }).returning();
    await audit(tx, { userId, action: "partner.distribution", entity: "partner", entityId: partnerId, detail: { amountPaise } });
    return d;
  });
}

/** Consolidated ledger (all partners + the owner's retained share) or a single partner. */
export async function partnerLedger(db: DB, onlyPartnerId?: string): Promise<LedgerRow[]> {
  const res = await db.execute(sql`
    select p.id as "partnerId", p.name,
      coalesce((select sum(amount_paise) from capital_contributions where partner_id = p.id), 0)::float8 as "capitalContributedPaise",
      coalesce((select sum(l.quantity_acquired * l.unit_cost_paise * o.ownership_bps / 10000.0)
                from lot_ownership_allocations o join inventory_lots l on l.id = o.lot_id where o.partner_id = p.id), 0)::float8 as "capitalDeployedPaise",
      coalesce((select sum(profit_paise) from lot_profit_allocations where partner_id = p.id), 0)::float8 as "profitAllocatedPaise",
      coalesce((select sum(amount_paise) from partner_distributions where partner_id = p.id), 0)::float8 as "distributedPaise"
    from partners p
    ${onlyPartnerId ? sql`where p.id = ${onlyPartnerId}` : sql``}
    order by p.created_at
  `);
  const rows: LedgerRow[] = (res.rows as Record<string, unknown>[]).map((r) => {
    const profit = Number(r.profitAllocatedPaise);
    const dist = Number(r.distributedPaise);
    return {
      partnerId: r.partnerId as string,
      name: r.name as string,
      capitalContributedPaise: Number(r.capitalContributedPaise),
      capitalDeployedPaise: Math.round(Number(r.capitalDeployedPaise)),
      profitAllocatedPaise: profit,
      distributedPaise: dist,
      pendingPayoutPaise: profit - dist,
    };
  });
  if (!onlyPartnerId) {
    const [owner] = (
      await db.execute(sql`select coalesce(sum(profit_paise),0)::float8 as p from lot_profit_allocations where partner_id is null`)
    ).rows as { p: number }[];
    rows.push({
      partnerId: null,
      name: "Owner (retained)",
      capitalContributedPaise: 0,
      capitalDeployedPaise: 0,
      profitAllocatedPaise: Number(owner.p),
      distributedPaise: 0,
      pendingPayoutPaise: 0,
    });
  }
  return rows;
}

export async function partnerDetail(db: DB, partnerId: string) {
  const [p] = await db.select().from(partners).where(eq(partners.id, partnerId));
  if (!p) throw notFound("Partner not found");
  const [ledger] = await partnerLedger(db, partnerId);
  const contributions = await db.select().from(capitalContributions).where(eq(capitalContributions.partnerId, partnerId)).orderBy(desc(capitalContributions.contributedOn));
  const distributions = await db.select().from(partnerDistributions).where(eq(partnerDistributions.partnerId, partnerId)).orderBy(desc(partnerDistributions.paidOn));
  return { partner: p, ledger, contributions, distributions };
}

export async function setLotOwnership(db: DB, lotId: string, shares: { partnerId: string; ownershipBps: number; profitShareBps: number }[], userId?: string) {
  validatePartnerShares(shares);
  await db.transaction(async (tx) => {
    await tx.delete(lotOwnershipAllocations).where(eq(lotOwnershipAllocations.lotId, lotId));
    if (shares.length) await tx.insert(lotOwnershipAllocations).values(shares.map((s) => ({ ...s, lotId })));
    await audit(tx, { userId, action: "lot.ownership", entity: "inventory_lot", entityId: lotId, detail: shares });
  });
}
