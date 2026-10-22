"use client";

import { ClipboardPaste, ImagePlus, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { ASPECTS, OUTPUT_WIDTHS, clampOffset, exportPlan, frameSize, layoutOf, type AspectId, type CropState, type FitMode } from "@/lib/image-crop";
import { cn } from "@/lib/utils";

const FRAME_W = 300;
const BACKGROUNDS = [
  { id: "#ffffff", label: "White" },
  { id: "#f2f0eb", label: "Off-white" },
  { id: "#141416", label: "Charcoal" },
  { id: "#000000", label: "Black" },
];

/** Draw the source (optionally rotated, and capped to 3000px) onto a canvas we can reuse for preview + export. */
async function loadSource(file: File, rotation: number): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const cap = Math.min(1, 3000 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * cap);
  const h = Math.round(bmp.height * cap);
  const turned = rotation % 180 !== 0;
  const c = document.createElement("canvas");
  c.width = turned ? h : w;
  c.height = turned ? w : h;
  const ctx = c.getContext("2d")!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
  return c;
}

export function ImageEditorDialog({ file, remaining, onCancel, onDone }: { file: File; remaining: number; onCancel: () => void; onDone: (f: File) => void | Promise<void> }) {
  const [rotation, setRotation] = React.useState(0);
  const [src, setSrc] = React.useState<HTMLCanvasElement | null>(null);
  const [srcUrl, setSrcUrl] = React.useState("");
  const [error, setError] = React.useState("");
  const [aspect, setAspect] = React.useState<AspectId>("4:5");
  const [mode, setMode] = React.useState<FitMode>("cover");
  const [bg, setBg] = React.useState("#ffffff");
  const [width, setWidth] = React.useState<number>(1200);
  const [zoom, setZoom] = React.useState(1);
  const [off, setOff] = React.useState({ dx: 0, dy: 0 });
  const [busy, setBusy] = React.useState(false);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  React.useEffect(() => {
    let alive = true;
    let url = "";
    loadSource(file, rotation)
      .then((c) => {
        if (!alive) return;
        c.toBlob((b) => {
          if (!b || !alive) return;
          url = URL.createObjectURL(b);
          setSrc(c);
          setSrcUrl(url);
        }, "image/png");
      })
      .catch(() => alive && setError("This image format can't be opened in the browser. Try a JPG, PNG or WebP (or take a screenshot of it)."));
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, rotation]);

  const { frameW, frameH } = frameSize(aspect, FRAME_W);
  const state: CropState | null = src ? { srcW: src.width, srcH: src.height, frameW, frameH, mode, zoom, dx: off.dx, dy: off.dy } : null;
  const layout = state ? layoutOf(state) : null;

  // keep the pan valid when zoom / mode / aspect change
  React.useEffect(() => {
    if (state) setOff((o) => clampOffset({ ...state, dx: o.dx, dy: o.dy }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, mode, aspect, src]);

  // wheel-to-zoom needs a non-passive listener
  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(4, Math.max(1, +(z - e.deltaY * 0.0015).toFixed(3))));
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [src]);

  // Escape closes only this editor, not the dialog underneath it
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [onCancel]);

  function onDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, dx: off.dx, dy: off.dy };
  }
  function onMove(e: React.PointerEvent) {
    if (!drag.current || !state) return;
    setOff(clampOffset({ ...state, dx: drag.current.dx + (e.clientX - drag.current.x), dy: drag.current.dy + (e.clientY - drag.current.y) }));
  }

  async function save() {
    if (!src || !state) return;
    setBusy(true);
    try {
      const p = exportPlan({ ...state, dx: off.dx, dy: off.dy }, width);
      const c = document.createElement("canvas");
      c.width = p.outW;
      c.height = p.outH;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, p.outW, p.outH);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, p.x, p.y, p.w, p.h);
      const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not export the image");
      await onDone(new File([blob], "photo.jpg", { type: "image/jpeg" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the photo");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/85 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Crop and resize photo">
      <div className="scroll-thin max-h-[96dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-surface sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h3 className="text-base font-semibold">Crop &amp; resize{remaining > 0 && <span className="ml-2 text-xs font-normal text-muted">+{remaining} more waiting</span>}</h3>
          <span className="text-xs text-muted">Drag to move · scroll or slide to zoom</span>
        </div>

        <div className="grid gap-6 p-5 md:grid-cols-[auto_1fr]">
          {/* WYSIWYG frame */}
          <div className="mx-auto">
            <div
              ref={frameRef}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
              className="relative cursor-grab touch-none overflow-hidden rounded-xl border border-line select-none active:cursor-grabbing"
              style={{ width: frameW, height: frameH, background: bg }}
            >
              {srcUrl && layout && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={srcUrl} alt="Photo being edited" draggable={false} className="pointer-events-none absolute max-w-none" style={{ width: layout.dispW, height: layout.dispH, left: layout.left, top: layout.top }} />
              )}
              {!srcUrl && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">Loading…</div>}
              <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden style={{ backgroundImage: "linear-gradient(to right, transparent 33%, rgba(255,255,255,.5) 33%, rgba(255,255,255,.5) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.5) 66%, rgba(255,255,255,.5) calc(66% + 1px), transparent calc(66% + 1px)), linear-gradient(to bottom, transparent 33%, rgba(255,255,255,.5) 33%, rgba(255,255,255,.5) calc(33% + 1px), transparent calc(33% + 1px), transparent 66%, rgba(255,255,255,.5) 66%, rgba(255,255,255,.5) calc(66% + 1px), transparent calc(66% + 1px))" }} />
            </div>
            <div className="mt-3 flex items-center gap-2">
              <ZoomOut size={15} className="text-muted" />
              <input type="range" min={1} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="flex-1 accent-[rgb(var(--accent))]" />
              <ZoomIn size={15} className="text-muted" />
              <Button type="button" variant="secondary" size="icon" aria-label="Rotate 90°" title="Rotate 90°" onClick={() => setRotation((r) => (r + 90) % 360)}><RotateCw size={16} /></Button>
            </div>
          </div>

          {/* options */}
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Shape <span className="font-normal">· shop cards are 4:5</span></div>
              <div className="flex flex-wrap gap-2">
                {ASPECTS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setAspect(a.id)} aria-pressed={aspect === a.id} className={cn("rounded-lg border px-3 py-1.5 text-sm", aspect === a.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}>{a.label}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Fit</div>
              <div className="flex gap-2">
                {([["cover", "Fill the frame (crop edges)"], ["contain", "Show the whole photo"]] as const).map(([id, label]) => (
                  <button key={id} type="button" onClick={() => { setMode(id); setZoom(1); setOff({ dx: 0, dy: 0 }); }} aria-pressed={mode === id} className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}>{label}</button>
                ))}
              </div>
            </div>
            {mode === "contain" && (
              <div>
                <div className="mb-2 text-xs font-medium text-muted">Background behind the photo</div>
                <div className="flex gap-2">
                  {BACKGROUNDS.map((b) => (
                    <button key={b.id} type="button" onClick={() => setBg(b.id)} aria-label={b.label} aria-pressed={bg === b.id} title={b.label} className={cn("h-8 w-8 rounded-full border-2", bg === b.id ? "border-accent" : "border-line")} style={{ background: b.id }} />
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="mb-2 text-xs font-medium text-muted">Output size <span className="font-normal">· {width} × {Math.round((width * frameH) / frameW)} px</span></div>
              <div className="flex gap-2">
                {OUTPUT_WIDTHS.map((w) => (
                  <button key={w} type="button" onClick={() => setWidth(w)} aria-pressed={width === w} className={cn("rounded-lg border px-3 py-1.5 text-sm", width === w ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}>{w === 800 ? "Small" : w === 1200 ? "Standard" : "Large"} · {w}px</button>
                ))}
              </div>
            </div>
            {error && <p role="alert" className="text-sm text-loss">{error}</p>}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>Skip this photo</Button>
          <Button onClick={save} disabled={!src || busy}>{busy ? "Saving…" : "Use photo"}</Button>
        </div>
      </div>
    </div>
  );
}

const isImage = (f: File) => f.type.startsWith("image/");

/**
 * Add photos by choosing files, dragging them in, or pasting (Ctrl+V anywhere while this is on screen).
 * Every photo opens in the crop/resize editor first; `onCropped` receives the finished JPEG.
 */
export function PhotoIntake({ onCropped, enabled = true, className, multiple = true }: { onCropped: (f: File) => void | Promise<void>; enabled?: boolean; className?: string; multiple?: boolean }) {
  const [queue, setQueue] = React.useState<File[]>([]);
  const [over, setOver] = React.useState(false);
  const [msg, setMsg] = React.useState("");
  const input = React.useRef<HTMLInputElement>(null);
  const add = React.useCallback((files: File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) return setMsg("That wasn't an image. Copy a picture (or choose a file) and try again.");
    setMsg("");
    setQueue((q) => [...q, ...(multiple ? imgs : imgs.slice(0, 1))]);
  }, [multiple]);

  React.useEffect(() => {
    if (!enabled) return;
    const h = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(isImage);
      if (files.length) {
        e.preventDefault();
        add(files);
      }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [enabled, add]);

  async function pasteButton() {
    setMsg("");
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const it of items) {
        const type = it.types.find((t) => t.startsWith("image/"));
        if (type) files.push(new File([await it.getType(type)], "pasted.png", { type }));
      }
      if (files.length) add(files);
      else setMsg("No picture on the clipboard. Copy an image first.");
    } catch {
      setMsg("Your browser blocked clipboard access. Press Ctrl+V (or ⌘V) on this page instead.");
    }
  }

  return (
    <div className={className}>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
        className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-5 text-center transition-colors", over ? "border-accent bg-accent/5" : "border-line")}
      >
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}><ImagePlus size={15} /> Choose photos</Button>
          <Button type="button" variant="secondary" size="sm" onClick={pasteButton}><ClipboardPaste size={15} /> Paste from clipboard</Button>
        </div>
        <p className="hidden text-xs text-muted sm:block">…or drag photos here, or just press <kbd className="rounded border border-line px-1">Ctrl</kbd>+<kbd className="rounded border border-line px-1">V</kbd> to paste a copied picture or screenshot</p>
        <input ref={input} type="file" accept="image/*" multiple={multiple} className="hidden" onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      </div>
      {msg && <p role="alert" className="mt-2 text-xs text-review">{msg}</p>}
      {queue[0] && (
        <ImageEditorDialog
          key={`${queue[0].name}-${queue[0].size}-${queue.length}`}
          file={queue[0]}
          remaining={queue.length - 1}
          onCancel={() => setQueue((q) => q.slice(1))}
          onDone={async (f) => {
            await onCropped(f);
            setQueue((q) => q.slice(1));
          }}
        />
      )}
    </div>
  );
}
