import { describe, expect, it } from "vitest";
import { baseScale, clampOffset, exportPlan, frameSize, layoutOf, type CropState } from "./image-crop";

const base: CropState = { srcW: 2000, srcH: 1000, frameW: 300, frameH: 375, mode: "cover", zoom: 1, dx: 0, dy: 0 };

describe("crop geometry", () => {
  it("cover scales so the shorter side fills the frame", () => {
    expect(baseScale(base)).toBeCloseTo(0.375); // 375 / 1000
    const l = layoutOf(base);
    expect(l.dispH).toBeCloseTo(375);
    expect(l.dispW).toBeCloseTo(750);
    expect(l.left).toBeCloseTo(-225); // centred
  });
  it("cover never lets the image leave empty space when panning", () => {
    expect(clampOffset({ ...base, dx: 9999, dy: 9999 })).toEqual({ dx: 225, dy: 0 });
    expect(clampOffset({ ...base, dx: -9999 }).dx).toBe(-225);
  });
  it("zooming in allows more panning but still covers", () => {
    const z = { ...base, zoom: 2 };
    const { dx, dy } = clampOffset({ ...z, dx: 9999, dy: 9999 });
    expect(dx).toBeCloseTo(600); // (1500-300)/2
    expect(dy).toBeCloseTo(187.5); // (750-375)/2
  });
  it("contain fits the whole image inside the frame", () => {
    const c = { ...base, mode: "contain" as const };
    expect(baseScale(c)).toBeCloseTo(0.15); // 300 / 2000
    const l = layoutOf(c);
    expect(l.dispW).toBeCloseTo(300);
    expect(l.dispH).toBeCloseTo(150);
    expect(l.top).toBeCloseTo(112.5);
  });
  it("export plan scales the frame to the requested width and keeps the ratio", () => {
    const p = exportPlan(base, 1200);
    expect(p.outW).toBe(1200);
    expect(p.outH).toBe(1500); // 4:5
    expect(p.h).toBeCloseTo(1500);
  });
  it("frame sizes follow the chosen aspect", () => {
    expect(frameSize("4:5", 300)).toEqual({ frameW: 300, frameH: 375 });
    expect(frameSize("1:1", 300)).toEqual({ frameW: 300, frameH: 300 });
    expect(frameSize("3:4", 300)).toEqual({ frameW: 300, frameH: 400 });
  });
});
