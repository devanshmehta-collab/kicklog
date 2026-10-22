import { describe, expect, it } from "vitest";
import { normalizeCustomSize, presetSizes, sizeKind, sortSizes } from "./sizes";

describe("size presets", () => {
  it("chooses the right set for the category", () => {
    expect(sizeKind("sneakers")).toBe("footwear");
    expect(sizeKind("Apparel")).toBe("apparel");
    expect(sizeKind("watches")).toBe("watch");
    expect(sizeKind("bags")).toBe("onesize");
    expect(presetSizes("sneakers")).toContain("10.5");
    expect(presetSizes("sneakers")[0]).toBe("4");
    expect(presetSizes("apparel")).toEqual(["XXS", "XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL"]);
    expect(presetSizes("watches")).toContain("41mm");
    expect(presetSizes("bags")).toEqual(["OS"]);
  });
  it("prefixes UK / US / EU labels when asked", () => {
    expect(presetSizes("sneakers", "UK")[0]).toBe("UK 3");
    expect(presetSizes("sneakers", "UK")).toContain("UK 9.5");
    expect(presetSizes("sneakers", "EU")).toContain("EU 42.5");
    expect(presetSizes("apparel", "UK")).toContain("M"); // clothing is never prefixed
  });
});

describe("sorting and cleaning", () => {
  it("sorts numerically (ignoring prefixes) and apparel in order", () => {
    expect(sortSizes(["10", "9", "9.5", "11"])).toEqual(["9", "9.5", "10", "11"]);
    expect(sortSizes(["UK 10", "UK 9"])).toEqual(["UK 9", "UK 10"]);
    expect(sortSizes(["XL", "S", "M", "L"])).toEqual(["S", "M", "L", "XL"]);
    expect(sortSizes(["Custom", "9", "M"])).toEqual(["M", "9", "Custom"]);
  });
  it("normalises typed sizes", () => {
    expect(normalizeCustomSize(" uk 9 ")).toBe("UK 9");
    expect(normalizeCustomSize("xl")).toBe("XL");
    expect(normalizeCustomSize("one size")).toBe("OS");
    expect(normalizeCustomSize("  10.5 ")).toBe("10.5");
    expect(normalizeCustomSize("   ")).toBe("");
  });
});
