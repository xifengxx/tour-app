import { describe, expect, it } from "vitest";
import { amapLegPath, buildRoutePath } from "./route-paths.ts";

const dirResponse = (points: string[][], meters: number) => ({
  ok: true,
  json: async () => ({
    status: "1",
    route: { paths: [{ distance: String(meters), steps: [{ polyline: points.map(p => p.join(",")).join(";") }] }] },
  }),
});

describe("route-paths 真实路径拼接（v99）", () => {
  it("按步行/驾车规划拼接，共享端点去重，stopKm 用真实里程", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      if (url.includes("walking")) return dirResponse([["100.0", "27.0"], ["100.05", "27.02"], ["100.1", "27.05"]], 1500);
      return dirResponse([["100.1", "27.05"], ["100.2", "27.1"]], 20000);
    }) as unknown as typeof fetch;
    const model = await buildRoutePath(
      [[100.0, 27.0], [100.1, 27.05], [100.2, 27.1]],
      ["walk", "shuttle"],
      fetchImpl,
      "test-key",
    );
    expect(model).toBeTruthy();
    expect(model!.planned).toBe(2);
    expect(model!.fellBack).toBe(0);
    expect(calls[0]).toContain("direction/walking");
    expect(calls[1]).toContain("direction/driving");
    // 段间共享端点 (100.1,27.05) 只出现一次
    const dup = model!.geom.filter(p => p[0] === 100.1 && p[1] === 27.05);
    expect(dup.length).toBe(1);
    expect(model!.stopKm).toEqual([0, 1.5, 21.5]);
    expect(model!.totalKm).toBe(21.5);
  });

  it("索道段不发请求、按直线回退；规划失败同样回退并计数", async () => {
    const fetchImpl = (async () => ({ ok: true, json: async () => ({ status: "0", info: "ENGINE_RESPONSE_DATA_ERROR" }) })) as unknown as typeof fetch;
    const model = await buildRoutePath(
      [[100.0, 27.0], [100.1, 27.0], [100.3, 27.0]],
      ["cableway", "walk"],
      fetchImpl,
      "test-key",
    );
    expect(model!.planned).toBe(0);
    expect(model!.fellBack).toBe(2);
    expect(model!.geom.length).toBe(3);
    // 直线回退里程≈真实球面距离（0.1° 经度 @27°N ≈ 9.92km，累计 19.84km）
    expect(Math.abs(model!.stopKm[1] - 9.92)).toBeLessThan(0.5);
    expect(Math.abs(model!.stopKm[2] - 29.76)).toBeLessThan(0.8);
  });

  it("无 Key 时整条直连（离线测试环境）", async () => {
    const model = await buildRoutePath([[100.0, 27.0], [100.01, 27.0]], ["walk"], (async () => { throw new Error("不该发请求"); }) as unknown as typeof fetch, "");
    expect(model!.fellBack).toBe(1);
  });

  it("amapLegPath 解析多 step 折线并过滤非法点", async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ route: { paths: [{ distance: "800", steps: [
        { polyline: "100.0,27.0;100.01,27.0" }, { polyline: "bad;100.02,27.0;100.02,27.01" },
      ] }] } }),
    })) as unknown as typeof fetch;
    const leg = await amapLegPath("walking", [100.0, 27.0], [100.02, 27.01], fetchImpl, "k");
    expect(leg!.geom).toEqual([[100.0, 27.0], [100.01, 27.0], [100.02, 27.0], [100.02, 27.01]]);
    expect(leg!.km).toBe(0.8);
  });
});
