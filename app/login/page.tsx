"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/client/api";

export default function LoginPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["setup-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      const j = await res.json();
      return { needsSetup: !!j.needsSetup, signedIn: res.ok };
    },
  });
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [err, setErr] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (status.data?.signedIn) router.replace("/dashboard");
  }, [status.data, router]);

  const setup = status.data?.needsSetup;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await apiFetch(setup ? "/api/auth/setup" : "/api/auth/login", { method: "POST", json: setup ? { email, password, name } : { email, password } });
      await qc.invalidateQueries();
      router.replace("/dashboard");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="grain relative hidden flex-col justify-between border-r border-line bg-surface p-12 lg:flex">
        <Link href="/" className="flex items-center gap-2.5 text-sm text-muted hover:text-fg"><ArrowLeft size={15} /> Back to the showroom</Link>
        <div>
          <p className="eyebrow">Reseller terminal</p>
          <h1 className="display mt-5 text-6xl">
            Type it.
            <br />
            <span className="text-muted">It&apos;s logged.</span>
          </h1>
          <p className="mt-6 max-w-sm text-muted">Say what you bought or sold — or snap the bill. Stock, profit and partner shares update on their own.</p>
        </div>
        <div className="text-xs text-muted">KICK LOG · Less logging. More selling.</div>
      </aside>

      <section className="flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fg text-sm font-bold text-bg">K</span>
            <span className="text-[13px] font-semibold tracking-[0.18em]">KICK LOG</span>
          </Link>
          <h2 className="text-2xl font-semibold tracking-tight">{setup ? "Create the owner account" : "Seller sign in"}</h2>
          <p className="mt-1.5 text-sm text-muted">{setup ? "First run — this account will own the business." : "Welcome back. Your stock and profit are waiting."}</p>
          <form onSubmit={submit} className="mt-8 space-y-4">
            {setup && (
              <Field label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </Field>
            )}
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </Field>
            <Field label="Password" hint={setup ? "At least 10 characters, with a number." : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 10 : 1} autoComplete={setup ? "new-password" : "current-password"} />
            </Field>
            {err && <p role="alert" className="rounded-lg border border-loss/30 bg-loss/10 px-3 py-2 text-sm text-loss">{err}</p>}
            <Button size="lg" className="w-full" disabled={busy || status.isLoading}>{busy ? "Please wait…" : setup ? "Create account" : "Sign in"}</Button>
          </form>
          <p className="mt-8 text-center text-sm text-muted lg:hidden"><Link href="/" className="hover:text-fg">← Back to the showroom</Link></p>
        </div>
      </section>
    </main>
  );
}
