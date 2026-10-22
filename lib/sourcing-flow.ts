export const SOURCING_FLOW = ["requested", "sourcing", "quoted", "confirmed", "purchased", "delivered", "completed"] as const;
export type SourcingStatus = (typeof SOURCING_FLOW)[number] | "cancelled";

/** A request may move one step forward, or be cancelled before it completes. It can never skip a step or move back. */
export function canTransition(from: SourcingStatus, to: SourcingStatus): boolean {
  if (from === "completed" || from === "cancelled") return false;
  if (to === "cancelled") return true;
  const i = SOURCING_FLOW.indexOf(from as (typeof SOURCING_FLOW)[number]);
  return SOURCING_FLOW[i + 1] === to;
}
