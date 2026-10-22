import { z } from "zod";
import { api } from "@/lib/api";
import { WRITE } from "@/lib/auth";
import { bps } from "@/lib/schemas";
import { setLotOwnership } from "@/lib/services/partners";

export const PUT = api(
  { roles: WRITE, body: z.object({ shares: z.array(z.object({ partnerId: z.string().uuid(), ownershipBps: bps, profitShareBps: bps })).max(10) }) },
  async ({ db, params, body, user }) => {
    await setLotOwnership(db, params.id, body.shares, user.id);
    return { ok: true };
  },
);
