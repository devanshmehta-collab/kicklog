/** Pure geometry for the photo cropper (no DOM), so it can be unit-tested. */

export const ASPECTS = [
  { id: "4:5", label: "4:5 · Shop card", w: 4, h: 5 },
  { id: "1:1", label: "1:1 · Square", w: 1, h: 1 },
  { id: "3:4", label: "3:4 · Portrait", w: 3, h: 4 },
] as const;
export type AspectId = (typeof ASPECTS)[number]["id"];
export const OUTPUT_WIDTHS = [800, 1200, 1600] as const;

export type FitMode = "cover" | "contain";

export interface CropState {
  srcW: number;
  srcH: number;
  frameW: number;
  frameH: number;
  mode: FitMode;
  /** 1 = the base fit (cover or contain). */
  zoom: number;
  /** Pan offset of the image centre from the frame centre, in frame pixels. */
  dx: number;
  dy: number;
}

export interface Layout {
  dispW: number;
  dispH: number;
  left: number;
  top: number;
}

/** Scale that makes the image just cover (fill) or just fit inside (contain) the frame. */
export function baseScale(s: Pick<CropState, "srcW" | "srcH" | "frameW" | "frameH" | "mode">): number {
  const sx = s.frameW / s.srcW;
  const sy = s.frameH / s.srcH;
  return s.mode === "cover" ? Math.max(sx, sy) : Math.min(sx, sy);
}

export function clampOffset(s: CropState): { dx: number; dy: number } {
  const k = baseScale(s) * s.zoom;
  const dispW = s.srcW * k;
  const dispH = s.srcH * k;
  if (s.mode === "cover") {
    // never reveal empty space: the image must keep covering the frame
    const mx = Math.max(0, (dispW - s.frameW) / 2);
    const my = Math.max(0, (dispH - s.frameH) / 2);
    return { dx: Math.min(mx, Math.max(-mx, s.dx)), dy: Math.min(my, Math.max(-my, s.dy)) };
  }
  // contain: free placement, but keep the image inside the frame when it is smaller than it
  const mx = Math.abs(s.frameW - dispW) / 2;
  const my = Math.abs(s.frameH - dispH) / 2;
  return { dx: Math.min(mx, Math.max(-mx, s.dx)), dy: Math.min(my, Math.max(-my, s.dy)) };
}

export function layoutOf(s: CropState): Layout {
  const { dx, dy } = clampOffset(s);
  const k = baseScale(s) * s.zoom;
  const dispW = s.srcW * k;
  const dispH = s.srcH * k;
  return { dispW, dispH, left: (s.frameW - dispW) / 2 + dx, top: (s.frameH - dispH) / 2 + dy };
}

/** Where to draw the source image on an output canvas of width outW (height follows the frame ratio). */
export function exportPlan(s: CropState, outW: number) {
  const scale = outW / s.frameW;
  const l = layoutOf(s);
  return {
    outW: Math.round(outW),
    outH: Math.round(s.frameH * scale),
    x: l.left * scale,
    y: l.top * scale,
    w: l.dispW * scale,
    h: l.dispH * scale,
  };
}

export function frameSize(aspectId: AspectId, width: number): { frameW: number; frameH: number } {
  const a = ASPECTS.find((x) => x.id === aspectId) ?? ASPECTS[0];
  return { frameW: width, frameH: Math.round((width * a.h) / a.w) };
}
