"use client";

import { Plus } from "lucide-react";
import * as React from "react";
import { SIZE_SYSTEMS, normalizeCustomSize, presetSizes, sizeKind, sortSizes, type SizeSystem } from "@/lib/sizes";
import { cn } from "@/lib/utils";

/**
 * Tap-to-select sizes. Presets follow the category (shoe sizes, S–XXL, watch case sizes, one size);
 * anything unusual can be typed in. Selected sizes that are not presets stay visible as chips.
 */
export function SizePicker({ category, selected, onToggle, label = "Sizes" }: { category: string; selected: string[]; onToggle: (size: string) => void; label?: string }) {
  const [system, setSystem] = React.useState<SizeSystem>("plain");
  const [custom, setCustom] = React.useState("");
  const kind = sizeKind(category);
  const presets = presetSizes(category, system);
  const extras = sortSizes(selected.filter((s) => !presets.includes(s)));
  const sel = new Set(selected);

  function addCustom() {
    const s = normalizeCustomSize(custom);
    if (s && !sel.has(s)) onToggle(s);
    setCustom("");
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">
          {label} <span className="font-normal">· tap to select{selected.length > 0 && ` · ${selected.length} chosen`}</span>
        </span>
        {kind === "footwear" && (
          <div className="flex gap-1" role="radiogroup" aria-label="Size system">
            {SIZE_SYSTEMS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={system === s.id} onClick={() => setSystem(s.id)} className={cn("rounded-md border px-2 py-0.5 text-[11px]", system === s.id ? "border-fg bg-fg text-bg" : "border-line text-muted hover:text-fg")}>
                {s.id === "plain" ? "No prefix" : s.id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {presets.map((s) => (
          <Chip key={s} on={sel.has(s)} onClick={() => onToggle(s)}>{s}</Chip>
        ))}
        {extras.map((s) => (
          <Chip key={s} on onClick={() => onToggle(s)}>{s}</Chip>
        ))}
      </div>
      <div className="mt-2.5 flex gap-2">
        <input
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addCustom();
            }
          }}
          placeholder="Other size (e.g. 10.5, UK 9, 42mm)"
          aria-label="Add another size"
          className="h-9 w-full max-w-xs rounded-lg border border-line bg-raised px-3 text-sm placeholder:text-muted/70 focus:border-fg/50"
        />
        <button type="button" onClick={addCustom} disabled={!custom.trim()} className="inline-flex h-9 items-center gap-1 rounded-lg border border-line px-3 text-sm text-muted hover:text-fg disabled:opacity-40">
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cn("min-w-10 rounded-lg border px-2.5 py-1.5 text-sm transition-colors", on ? "border-fg bg-fg font-medium text-bg" : "border-line text-muted hover:border-fg/50 hover:text-fg")}>
      {children}
    </button>
  );
}
