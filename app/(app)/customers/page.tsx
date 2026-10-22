"use client";

import { MessageCircle, Plus, Search } from "lucide-react";
import * as React from "react";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Badge, Card, Dialog, Empty, Field, Input, Money, Select, Table, Td, Textarea, Th } from "@/components/ui/primitives";
import { ApiError, useGet, useSend } from "@/lib/client/api";
import type { listCustomers } from "@/lib/services/customers";

type Customer = Awaited<ReturnType<typeof listCustomers>>[number];
const blank = { name: "", phone: "", instagram: "", email: "", city: "", type: "D2C", notes: "" };

export default function CustomersPage() {
  const { user } = useMe();
  const write = canWrite(user?.role);
  const [q, setQ] = React.useState("");
  const list = useGet<Customer[]>(["customers", q], `/api/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const [edit, setEdit] = React.useState<Customer | "new" | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
        {write && <Button onClick={() => setEdit("new")}><Plus size={16} /> Add customer</Button>}
      </div>
      <div className="relative max-w-md">
        <Search size={15} className="absolute top-3 left-3 text-muted" />
        <Input className="pl-9" placeholder="Search name, phone, Instagram" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card>
        <Table>
          <thead><tr><Th>Customer</Th><Th>Type</Th><Th className="text-right">Orders</Th><Th className="text-right">Lifetime spend</Th><Th className="text-right">Avg order</Th><Th>Last purchase</Th><Th /></tr></thead>
          <tbody>
            {list.data?.map((c) => (
              <tr key={c.id}>
                <Td>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted">{[c.city, c.phone, c.instagram && `@${c.instagram.replace(/^@/, "")}`].filter(Boolean).join(" · ")}</div>
                </Td>
                <Td><Badge tone={c.type === "B2B" ? "review" : "neutral"}>{c.type}</Badge></Td>
                <Td className="text-right num">{c.orders}{c.repeatPurchases > 0 && <span className="ml-1 text-xs text-gain">↻{c.repeatPurchases}</span>}</Td>
                <Td className="text-right"><Money paise={c.lifetimeSpendPaise} /></Td>
                <Td className="text-right"><Money paise={c.avgOrderValuePaise} /></Td>
                <Td className="whitespace-nowrap text-muted">{c.lastPurchase ? new Date(c.lastPurchase).toLocaleDateString("en-IN") : "—"}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    {c.phone && (
                      <a href={`https://wa.me/${c.phone.replace(/\D/g, "").replace(/^(\d{10})$/, "91$1")}`} target="_blank" rel="noreferrer" aria-label={`WhatsApp ${c.name}`} className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-raised hover:text-gain">
                        <MessageCircle size={16} />
                      </a>
                    )}
                    {write && <Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Edit</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {list.data?.length === 0 && <Empty>No customers yet. They are created automatically when you record a sale for a named buyer.</Empty>}
      </Card>
      <CustomerDialog value={edit} onClose={() => setEdit(null)} />
    </div>
  );
}

function CustomerDialog({ value, onClose }: { value: Customer | "new" | null; onClose: () => void }) {
  const [f, setF] = React.useState(blank);
  const [error, setError] = React.useState("");
  const isNew = value === "new";
  const id = value && value !== "new" ? value.id : "";
  const send = useSend<Record<string, unknown>, unknown>(isNew ? "POST" : "PATCH", isNew ? "/api/customers" : `/api/customers/${id}`);
  React.useEffect(() => {
    if (value && value !== "new") setF({ name: value.name, phone: value.phone ?? "", instagram: value.instagram ?? "", email: value.email ?? "", city: value.city ?? "", type: value.type, notes: value.notes ?? "" });
    else setF(blank);
    setError("");
  }, [value]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    try {
      await send.mutateAsync({ ...f, phone: f.phone || null, instagram: f.instagram || null, email: f.email || null, city: f.city || null, notes: f.notes || null });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save");
    }
  }
  return (
    <Dialog open={!!value} onClose={onClose} title={isNew ? "Add customer" : "Edit customer"}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Phone / WhatsApp"><Input value={f.phone} onChange={set("phone")} /></Field>
        <Field label="Instagram"><Input value={f.instagram} onChange={set("instagram")} /></Field>
        <Field label="Email (optional)"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="City"><Input value={f.city} onChange={set("city")} /></Field>
        <Field label="Type"><Select value={f.type} onChange={set("type")}><option>D2C</option><option>B2B</option></Select></Field>
        <Field label="Notes" className="sm:col-span-2"><Textarea rows={2} value={f.notes} onChange={set("notes")} /></Field>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!f.name.trim() || send.isPending}>Save</Button></div>
    </Dialog>
  );
}
