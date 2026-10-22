"use client";

import * as React from "react";
import { canWrite, useMe } from "@/components/providers";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Field, Input, Select, Table, Td, Th } from "@/components/ui/primitives";
import { ApiError, apiFetch, useGet } from "@/lib/client/api";
import type { Settings } from "@/lib/services/settings";
import { useQueryClient } from "@tanstack/react-query";

export default function SettingsPage() {
  const { user } = useMe();
  const owner = user?.role === "owner";
  const settings = useGet<Settings>(["settings"], "/api/settings");
  const [f, setF] = React.useState<Record<string, string>>({});
  const [msg, setMsg] = React.useState("");
  const qc = useQueryClient();
  React.useEffect(() => {
    const s = settings.data;
    if (s) setF({ businessName: s.businessName, whatsappNumber: s.whatsappNumber, phone: s.phone, lowStockThreshold: String(s.lowStockThreshold), slowMovingDays: String(s.slowMovingDays), hosts: s.importAllowedHosts.join(", ") });
  }, [settings.data]);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setMsg("");
    try {
      await apiFetch("/api/settings", { method: "PUT", json: { businessName: f.businessName, whatsappNumber: f.whatsappNumber, phone: f.phone, lowStockThreshold: Number(f.lowStockThreshold), slowMovingDays: Number(f.slowMovingDays), importAllowedHosts: f.hosts.split(",").map((s) => s.trim()).filter(Boolean) } });
      await qc.invalidateQueries();
      setMsg("Saved");
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Failed");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Card>
        <CardHeader title="Business" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
          <Field label="Business name"><Input value={f.businessName ?? ""} onChange={set("businessName")} disabled={!owner} /></Field>
          <Field label="WhatsApp number" hint="Digits with country code, e.g. 919876543210"><Input value={f.whatsappNumber ?? ""} onChange={set("whatsappNumber")} disabled={!owner} /></Field>
          <Field label="Phone (shown to customers)"><Input value={f.phone ?? ""} onChange={set("phone")} disabled={!owner} /></Field>
          <Field label="Low-stock threshold (units)"><Input value={f.lowStockThreshold ?? ""} onChange={set("lowStockThreshold")} inputMode="numeric" disabled={!owner} /></Field>
          <Field label="Slow-moving after (days)"><Input value={f.slowMovingDays ?? ""} onChange={set("slowMovingDays")} inputMode="numeric" disabled={!owner} /></Field>
          <Field label="Import allowed sites" hint="Comma-separated hostnames"><Input value={f.hosts ?? ""} onChange={set("hosts")} disabled={!owner} /></Field>
          {owner && <div className="flex items-center gap-3 sm:col-span-2"><Button onClick={save}>Save settings</Button>{msg && <span className="text-sm text-muted">{msg}</span>}</div>}
          {!owner && <p className="text-sm text-muted sm:col-span-2">Only the owner can change settings.</p>}
        </div>
      </Card>
      <PasswordCard />
      {owner && <UsersCard />}
      {canWrite(user?.role) && <p className="text-xs text-muted">AI keys (Anthropic, Gemini) live only in server environment variables and are never shown here.</p>}
    </div>
  );
}

function UsersCard() {
  const users = useGet<{ id: string; email: string; name: string; role: string }[]>(["users"], "/api/users");
  const partners = useGet<{ ledger?: { partnerId: string | null; name: string }[] }>(["partners"], "/api/partners");
  const [f, setF] = React.useState({ name: "", email: "", password: "", role: "viewer", partnerId: "" });
  const [msg, setMsg] = React.useState("");
  const qc = useQueryClient();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function add() {
    setMsg("");
    try {
      await apiFetch("/api/users", { method: "POST", json: { ...f, partnerId: f.partnerId || null } });
      setF({ name: "", email: "", password: "", role: "viewer", partnerId: "" });
      await qc.invalidateQueries({ queryKey: ["users"] });
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Failed");
    }
  }
  return (
    <Card>
      <CardHeader title="Team & access" />
      <Table><thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th></tr></thead><tbody>{users.data?.map((u) => <tr key={u.id}><Td>{u.name}</Td><Td className="text-muted">{u.email}</Td><Td className="capitalize">{u.role}</Td></tr>)}</tbody></Table>
      <div className="grid gap-3 border-t border-line p-5 sm:grid-cols-2">
        <Field label="Name"><Input value={f.name} onChange={set("name")} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label="Temporary password" hint="10+ characters with a number"><Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <Field label="Role"><Select value={f.role} onChange={set("role")}><option value="admin">Admin — full access except owner settings</option><option value="viewer">Viewer — read-only</option><option value="partner">Partner — own ledger only</option><option value="owner">Owner</option></Select></Field>
        {f.role === "partner" && <Field label="Linked partner"><Select value={f.partnerId} onChange={set("partnerId")}><option value="">Select…</option>{partners.data?.ledger?.filter((p) => p.partnerId).map((p) => <option key={p.partnerId!} value={p.partnerId!}>{p.name}</option>)}</Select></Field>}
        <div className="flex items-center gap-3 sm:col-span-2"><Button onClick={add} disabled={!f.name || !f.email || f.password.length < 10}>Add user</Button>{msg && <span role="alert" className="text-sm text-loss">{msg}</span>}</div>
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [f, setF] = React.useState({ current: "", next: "" });
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    setMsg(null);
    try {
      await apiFetch("/api/auth/password", { method: "POST", json: f });
      setF({ current: "", next: "" });
      setMsg({ ok: true, text: "Password changed. Other devices were signed out." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "Failed" });
    }
  }
  return (
    <Card>
      <CardHeader title="Your password" />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2">
        <Field label="Current password"><Input type="password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password" hint="10+ characters with a number"><Input type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></Field>
        <div className="flex items-center gap-3 sm:col-span-2"><Button onClick={save} disabled={!f.current || f.next.length < 10}>Change password</Button>{msg && <span role="status" className={`text-sm ${msg.ok ? "text-gain" : "text-loss"}`}>{msg.text}</span>}</div>
      </div>
    </Card>
  );
}
