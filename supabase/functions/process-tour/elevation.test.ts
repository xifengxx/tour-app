import { describe, it, expect } from "vitest";
import { interpolateStops, elevationGain, elevationProfile } from "./elevation.ts";

describe("interpolateStops", () => {
  it("two stops → even spacing along the line", () => {
    const result = interpolateStops(
      [{ lng: 110, lat: 30 }, { lng: 110.1, lat: 30.1 }],
      5,
    );
    expect(result).toHaveLength(5);
    expect(result[0].km).toBeCloseTo(0, 1);
    expect(result[4].km).toBeCloseTo(result[4].km, 1); // last point has max km
    expect(result[0].lng).toBeCloseTo(110, 3);
    expect(result[4].lng).toBeCloseTo(110.1, 3);
  });

  it("fewer than 2 stops → passthrough with km=0", () => {
    const result = interpolateStops([{ lng: 110, lat: 30 }], 10);
    expect(result).toHaveLength(1);
    expect(result[0].km).toBe(0);
  });

  it("zero distance → all km=0", () => {
    const result = interpolateStops(
      [{ lng: 110, lat: 30 }, { lng: 110, lat: 30 }],
      5,
    );
    expect(result.every(p => p.km === 0)).toBe(true);
  });

  it("three stops → intermediate points respect polyline shape", () => {
    const result = interpolateStops(
      [
        { lng: 110, lat: 30 },
        { lng: 110.1, lat: 30 },
        { lng: 110.1, lat: 30.1 },
      ],
      7,
    );
    expect(result).toHaveLength(7);
    // First point at origin, last at destination
    expect(result[0].lat).toBeCloseTo(30, 3);
    expect(result[6].lat).toBeCloseTo(30.1, 3);
    // Middle of route should have lng ≈ 110.1 (the second leg is N-S)
    expect(result[3].lng).toBeCloseTo(110.1, 2);
  });
});

describe("elevationGain", () => {
  it("only positive deltas accumulate", () => {
    const profile = [
      { km: 0, m: 100 },
      { km: 1, m: 200 },
      { km: 2, m: 150 },
      { km: 3, m: 300 },
    ];
    // 100 up + 50 down + 150 up = 250 gain
    expect(elevationGain(profile)).toBe(250);
  });

  it("flat profile → gain 0", () => {
    const profile = [
      { km: 0, m: 500 },
      { km: 1, m: 500 },
      { km: 2, m: 500 },
    ];
    expect(elevationGain(profile)).toBe(0);
  });
});

describe("elevationProfile", () => {
  it("fewer than 2 stops → null", async () => {
    const result = await elevationProfile([{ lng: 110, lat: 30 }]);
    expect(result).toBeNull();
  });

  it("null/undefined input → null", async () => {
    expect(await elevationProfile(null as any)).toBeNull();
    expect(await elevationProfile(undefined as any)).toBeNull();
  });

  it("non-finite coords filtered out → null if < 2 remain", async () => {
    const result = await elevationProfile([
      { lng: NaN, lat: 30 },
      { lng: 110, lat: NaN },
    ]);
    expect(result).toBeNull();
  });
});

// v99：数据源与坐标纪律
import { gcj02ToWgs84 } from "./elevation.ts";

describe("GCJ-02 → WGS-84（v99 坐标纪律）", () => {
  it("中国境内产生 100-800m 量级偏移，境外原样返回", () => {
    const [wLng, wLat] = gcj02ToWgs84(116.397, 39.909); // 北京
    const dKm = Math.hypot((116.397 - wLng) * 85, (39.909 - wLat) * 111);
    expect(dKm).toBeGreaterThan(0.3);
    expect(dKm).toBeLessThan(1.2);
    expect(gcj02ToWgs84(-73.98, 40.75)).toEqual([-73.98, 40.75]); // 纽约
  });
});
