"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Clock, ImagePlus, Loader2, Sparkles, TriangleAlert, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Card, Textarea } from "@/components/ui/primitives";
import { ApiError, apiFetch, newKey } from "@/lib/client/api";
import { MAX_IMAGES_PER_LOG, compressImage } from "@/lib/image";
import { cn } from "@/lib/utils";

interface Outcome {
  status: "saved" | "needs_review" | "duplicate_in_progress";
  message: string;
  kind?: string;
  problems?: string[];
  aiFailed?: boolean;
  elapsedMs: number;
  duplicate?: boolean;
}

type Result = { kind: "saved" | "review" | "error"; text: string; detail?: string[]; serverMs?: number; clientMs: number };

const DRAFT_KEY = "kicklog:draft";
const EXAMPLES = ["Bought AJ1 Chicago size 10 for ₹18,000 incl shipping", "Sold the Chicago 10s for ₹22,000, ₹500 shipping", "Bought 2 pairs of Panda Dunks size 9 for ₹12,000 each"];

export function QuickLog({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const [text, setText] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [previews, setPreviews] = React.useState<string[]>([]);
  const [pending, setPending] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [result, setResult] = React.useState<Result | null>(null);
  const keyRef = React.useRef<string>(newKey());
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    try {
      setText(localStorage.getItem(DRAFT_KEY) ?? "");
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [text]);

  React.useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  React.useEffect(() => {
    if (!pending) return;
    const t0 = performance.now();
    const id = setInterval(() => setElapsed(performance.now() - t0), 100);
    return () => clearInterval(id);
  }, [pending]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((cur) => [...cur, ...Array.from(list)].slice(0, MAX_IMAGES_PER_LOG));
    keyRef.current = newKey(); // different payload → new idempotency key
  }

  async function submit() {
    if (pending || (!text.trim() && !files.length)) return;
    setPending(true);
    setResult(null);
    setElapsed(0);
    const t0 = performance.now();
    try {
      const fd = new FormData();
      fd.set("text", text);
      fd.set("idempotencyKey", keyRef.current);
      for (const f of await Promise.all(files.map((f) => compressImage(f)))) fd.append("images", f);
      const out = await apiFetch<Outcome>("/api/log", { method: "POST", body: fd });
      const clientMs = performance.now() - t0;
      if (out.status === "saved") setResult({ kind: "saved", text: out.message, serverMs: out.elapsedMs, clientMs });
      else if (out.status === "needs_review") setResult({ kind: "review", text: out.aiFailed ? "AI unavailable — saved to Needs Review" : "Needs your review — nothing was changed", detail: out.problems, serverMs: out.elapsedMs, clientMs });
      else setResult({ kind: "error", text: "This entry is still processing. Try again in a moment.", clientMs });
      if (out.status !== "duplicate_in_progress") {
        setText("");
        setFiles([]);
        keyRef.current = newKey();
      }
      await qc.invalidateQueries();
    } catch (e) {
      const clientMs = performance.now() - t0;
      const msg = e instanceof ApiError ? e.message : "Network problem. Your entry is kept — retrying is safe and will not duplicate anything.";
      setResult({ kind: "error", text: msg, clientMs });
    } finally {
      setPending(false);
    }
  }

  const seconds = (ms: number) => (ms / 1000).toFixed(1) + "s";

  return (
    <Card className="relative overflow-hidden border-accent/30 p-4 shadow-[0_0_0_1px_rgb(var(--accent)/0.08),0_20px_60px_-30px_rgb(var(--accent)/0.35)] sm:p-6">
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent" aria-hidden />
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles size={16} className="text-accent" /> AI Quick Log
        </div>
        <span className="hidden text-xs text-muted sm:block">Purchase or sale — just say what happened · <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px]">Ctrl</kbd> <kbd className="rounded border border-line px-1.5 py-0.5 text-[10px]">Enter</kbd> to log</span>
      </div>
      <div className="rounded-xl border border-line bg-raised focus-within:border-fg/50">
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            keyRef.current = newKey();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
          }}
          rows={3}
          disabled={!canWrite}
          aria-label="Describe a purchase or a sale"
          placeholder={canWrite ? "Bought AJ1 Chicago size 10 for ₹18,000 incl shipping…" : "Your role is read-only"}
          className="resize-none border-0 bg-transparent focus:border-0"
        />
        {previews.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pb-2">
            {previews.map((src, i) => (
              <div key={src} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Attachment ${i + 1}`} className="h-14 w-14 rounded-lg border border-line object-cover" />
                <button
                  aria-label="Remove image"
                  onClick={() => setFiles((f) => f.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 rounded-full bg-bg p-0.5 text-muted ring-1 ring-line hover:text-fg"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-2">
          <div className="flex items-center gap-1">
            <input ref={fileInput} type="file" accept="image/*" multiple capture={undefined} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={!canWrite || files.length >= MAX_IMAGES_PER_LOG} aria-label="Attach photo or bill">
              <ImagePlus size={16} /> <span className="hidden sm:inline">Photo / bill</span>
            </Button>
          </div>
          <div className="flex items-center gap-3">
            {pending && (
              <span className="flex items-center gap-1.5 text-sm text-muted num" role="timer" aria-live="off">
                <Clock size={14} /> {seconds(elapsed)}
              </span>
            )}
            <Button onClick={submit} disabled={!canWrite || pending || (!text.trim() && !files.length)} className="min-w-24">
              {pending ? <Loader2 size={16} className="animate-spin" /> : null}
              {pending ? "Logging" : "Log It"}
            </Button>
          </div>
        </div>
      </div>

      {!result && !pending && canWrite && (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} onClick={() => setText(ex)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-fg/40 hover:text-fg">
              {ex}
            </button>
          ))}
        </div>
      )}

      <div aria-live="polite">
        {result && (
          <div
            className={cn(
              "mt-3 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
              result.kind === "saved" && "border-gain/30 bg-gain/10",
              result.kind === "review" && "border-review/30 bg-review/10",
              result.kind === "error" && "border-loss/30 bg-loss/10",
            )}
          >
            {result.kind === "saved" ? <Check size={16} className="mt-0.5 text-gain" /> : <TriangleAlert size={16} className={cn("mt-0.5", result.kind === "review" ? "text-review" : "text-loss")} />}
            <div className="min-w-0 flex-1">
              <div className="font-medium">{result.text}</div>
              {result.detail?.slice(0, 3).map((d) => (
                <div key={d} className="text-muted">{d}</div>
              ))}
              <div className="mt-1 text-xs text-muted num">
                {seconds(result.clientMs)} total{result.serverMs != null && <> · {seconds(result.serverMs)} server</>}
                {result.clientMs > 10_000 && <> · slower than the 10s target</>}
              </div>
            </div>
            <button aria-label="Dismiss" onClick={() => setResult(null)} className="text-muted hover:text-fg">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
