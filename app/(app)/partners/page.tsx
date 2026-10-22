"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Dialog, Empty, Field, Input, Money, Table, Td, Th } from "@/components/ui/primitives";
import { ApiError, apiFetch, useGet } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";
import type { LedgerRow, partnerDetail } from "@/lib/services/partners";
import { useQueryClient } from "@tanstack/react-query";

type Detail = Awaited<ReturnType<typeof partnerDetail>>;

export default function PartnersPage() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const isOwner = user?.role === "owner";
  const data = useGet<{ ledger?: LedgerRow[]; mine?: Detail }>(["partners"], "/api/partners");
  const [dialog, setDialog] = React.useState<{ kind: "partner" | "contribution" | "distribution"; row?: LedgerRow } | null>(null);

  if (data.data?.mine) return <PartnerSelfView d={data.data.mine} />;
  const ledger = data.data?.ledger ?? [];
  const sum = (k: keyof LedgerRow) => ledger.reduce((a, r) => a + (r[k] as number), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Partners</h1>
          <p className="text-sm text-muted">Co-investors, profit shares and payouts. Assign partners to a lot when you add or restock a product.</p>
        </div>
        {write && <Button onClick={() => setDialog({ kind: "partner" })}><Plus size={16} /> Add partner</Button>}
      </div>
      <Card>
        <CardHeader title="Consolidated ledger" />
        <Table>
          <thead><tr><Th>Partner</Th><Th className="text-right">Capital contributed</Th><Th className="text-right">Capital in stock</Th><Th className="text-right">Profit allocated</Th><Th className="text-right">Paid out</Th><Th className="text-right">Pending payout</Th><Th /></tr></thead>
          <tbody>
            {ledger.map((r) => (
              <tr key={r.partnerId ?? "owner"}>
                <Td className="font-medium">{r.name}</Td>
                <Td className="text-right"><Money paise={r.capitalContributedPaise} /></Td>
                <Td className="text-right"><Money paise={r.capitalDeployedPaise} /></Td>
                <Td className="text-right"><Money paise={r.profitAllocatedPaise} signed /></Td>
                <Td className="text-right"><Money paise={r.distributedPaise} /></Td>
                <Td className="text-right font-medium"><Money paise={r.pendingPayoutPaise} /></Td>
                <Td className="text-right whitespace-nowrap">
                  {r.partnerId && write && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "contribution", row: r })}>+ Capital</Button>}
                  {r.partnerId && isOwner && r.pendingPayoutPaise > 0 && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "distribution", row: r })}>Pay out</Button>}
                </Td>
              </tr>
            ))}
            {ledger.length > 1 && (
              <tr className="font-medium">
                <Td>Total</Td>
                <Td className="text-right"><Money paise={sum("capitalContributedPaise")} /></Td>
                <Td className="text-right"><Money paise={sum("capitalDeployedPaise")} /></Td>
                <Td className="text-right"><Money paise={sum("profitAllocatedPaise")} signed /></Td>
                <Td className="text-right"><Money paise={sum("distributedPaise")} /></Td>
                <Td className="text-right"><Money paise={sum("pendingPayoutPaise")} /></Td>
                <Td />
              </tr>
            )}
          </tbody>
        </Table>
        {ledger.length <= 1 && <Empty>No partners yet.</Empty>}
      </Card>
      <PartnerDialog state={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}

function PartnerSelfView({ d }: { d: Detail }) {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Your partnership — {d.partner.name}</h1>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Capital contributed", d.ledger.capitalContributedPaise], ["Capital in stock", d.ledger.capitalDeployedPaise], ["Profit allocated", d.ledger.profitAllocatedPaise], ["Pending payout", d.ledger.pendingPayoutPaise]].map(([l, v]) => (
          <Card key={l as string} className="px-5 py-4"><div className="text-xs tracking-wide text-muted uppercase">{l}</div><div className="mt-1 text-2xl font-semibold"><Money paise={v as number} /></div></Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Contributions" />
        <Table><tbody>{d.contributions.map((c) => <tr key={c.id}><Td>{new Date(c.contributedOn).toLocaleDateString("en-IN")}</Td><Td className="text-muted">{c.note}</Td><Td className="text-right"><Money paise={c.amountPaise} /></Td></tr>)}</tbody></Table>
        {d.contributions.length === 0 && <Empty>None yet.</Empty>}
      </Card>
      <Card>
        <CardHeader title="Payouts received" />
        <Table><tbody>{d.distributions.map((c) => <tr key={c.id}><Td>{new Date(c.paidOn).toLocaleDateString("en-IN")}</Td><Td className="text-muted">{c.note}</Td><Td className="text-right"><Money paise={c.amountPaise} /></Td></tr>)}</tbody></Table>
        {d.distributions.length === 0 && <Empty>None yet.</Empty>}
      </Card>
    </div>
  );
}

function PartnerDialog({ state, onClose }: { state: { kind: "partner" | "contribution" | "distribution"; row?: LedgerRow } | null; onClose: () => void }) {
  const [f, setF] = React.useState({ name: "", phone: "", email: "", amount: "", note: "" });
  const [error, setError] = React.useState("");
  const qc = useQueryClient();
  React.useEffect(() => { setF({ name: "", phone: "", email: "", amount: "", note: "" }); setError(""); }, [state]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    if (!state) return;
    try {
      if (state.kind === "partner") await apiFetch("/api/partners", { method: "POST", json: { name: f.name, phone: f.phone || null, email: f.email || null } });
      else await apiFetch(`/api/partners/${state.row!.partnerId}/${state.kind === "contribution" ? "contributions" : "distributions"}`, { method: "POST", json: { amountPaise: rupeesToPaise(Number(f.amount)), note: f.note || null } });
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed");
    }
  }
  const title = state?.kind === "partner" ? "Add partner" : state?.kind === "contribution" ? `Capital contribution — ${state.row?.name}` : `Pay out — ${state?.row?.name}`;
  return (
    <Dialog open={!!state} onClose={onClose} title={title}>
      <div className="grid gap-3">
        {state?.kind === "partner" ? (
          <>
            <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
            <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Email"><Input value={f.email} onChange={set("email")} /></Field>
          </>
        ) : (
          <>
            <Field label="Amount ₹" hint={state?.kind === "distribution" ? `Up to ₹${((state.row?.pendingPayoutPaise ?? 0) / 100).toLocaleString("en-IN")} pending` : undefined}><Input inputMode="decimal" value={f.amount} onChange={set("amount")} /></Field>
            <Field label="Note"><Input value={f.note} onChange={set("note")} /></Field>
          </>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></div>
    </Dialog>
  );
}
