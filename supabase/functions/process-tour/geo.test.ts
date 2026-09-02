import { describe, expect, it } from "vitest";
import { haversineM } from "./geo.ts";

describe("haversineM", () => {
  it("同一点距离为 0", () => {
    expect(haversineM({ lng: 116, lat: 39 }, { lng: 116, lat: 39 })).toBe(0);
  });

  it("计算北京一度经度的近似距离", () => {
    const distance = haversineM({ lng: 116, lat: 39 }, { lng: 117, lat: 39 });
    expect(distance).toBeGreaterThan(85000);
    expect(distance).toBeLessThan(90000);
  });
});
