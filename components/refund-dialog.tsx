"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Input, Money, Select } from "@/components/ui/primitives";
import { ApiError, newKey, useSend } from "@/lib/client/api";
import { rupeesToPaise } from "@/lib/money";

export interface SaleLike {
  id: string;
  items: { id: string; name: string; size: string; quantity: number; refundedQuantity: number; unitPricePaise: number }[];
}

export function RefundDialog({ sale, onClose }: { sale: SaleLike | null; onClose: () => void }) {
  const refundable = sale?.items.filter((i) => i.quantity - i.refundedQuantity > 0) ?? [];
  const [itemId, setItemId] = React.useState("");
  const [qty, setQty] = React.useState("1");
  const [restock, setRestock] = React.useState("yes");
  const [amount, setAmount] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState("");
  const keyRef = React.useRef(newKey());
  const send = useSend<Record<string, unknown>, unknown>("POST", `/api/sales/${sale?.id}/refund`);

  React.useEffect(() => {
    if (sale) {
      setItemId(refundable[0]?.id ?? "");
      setQty("1");
      setAmount("");
      setError("");
      keyRef.current = newKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale?.id]);

  const item = refundable.find((i) => i.id === itemId);
  async function submit() {
    setError("");
    try {
      await send.mutateAsync({
        saleItemId: itemId,
        quantity: Number(qty),
        restock: restock === "yes",
        amountPaise: amount ? rupeesToPaise(Number(amount)) : undefined,
        reason: reason || null,
        idempotencyKey: keyRef.current,
      });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Refund failed");
    }
  }

  return (
    <Dialog open={!!sale} onClose={onClose} title="Refund / reverse sale">
      {refundable.length === 0 ? (
        <p className="text-sm text-muted">Everything in this sale has already been refunded.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Item">
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {refundable.map((i) => (
                <option key={i.id} value={i.id}>{i.name} — size {i.size} ({i.quantity - i.refundedQuantity} refundable)</option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Units"><Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Back in stock?" hint="Damaged items are not restocked">
              <Select value={restock} onChange={(e) => setRestock(e.target.value)}>
                <option value="yes">Yes — restock</option>
                <option value="no">No — damaged / write off</option>
              </Select>
            </Field>
          </div>
          <Field label="Refund amount (₹)" hint="Leave blank to refund what the buyer paid for these units">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Auto" />
          </Field>
          {item && <p className="text-xs text-muted">Unit price paid: <Money paise={item.unitPricePaise} /></p>}
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          {error && <p role="alert" className="text-sm text-loss">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="danger" onClick={submit} disabled={send.isPending || !itemId}>Issue refund</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
