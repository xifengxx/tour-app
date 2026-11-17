import { describe, expect, it } from "vitest";
import { clusterOrderStops, minimizeOpenPath, orderStopsGeographic } from "./routes.ts";

// 近似的米制距离，用于断言总里程下降
const pathM = (order: string[], locs: any[]) => {
  const byId = new Map(locs.map(l => [l.id, l]));
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    const a = byId.get(order[i])!;
    const b = byId.get(order[i + 1])!;
    const dLat = (b.lat - a.lat) * 111320;
    const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    total += Math.hypot(dLat, dLng);
  }
  return total;
};

describe("minimizeOpenPath 开放链全局优化", () => {
  it("两簇点时不再来回穿插", () => {
    const locs = [
      { id: "a", lat: 30.55, lng: 114.40 },
      { id: "b", lat: 30.552, lng: 114.402 },
      { id: "c", lat: 30.56, lng: 114.36 },
      { id: "d", lat: 30.561, lng: 114.362 },
    ];
    const zigzag = ["a", "c", "b", "d"];
    const fixed = minimizeOpenPath(zigzag, locs);
    expect(fixed[0]).toBe("a"); // 起点（入口最近点）固定不变
    expect(pathM(fixed, locs)).toBeLessThan(pathM(zigzag, locs));
    // c/d 两条顺序总长等价（相距仅百米），只要求同簇相邻、起点固定
    expect(fixed.slice(0, 2)).toEqual(["a", "b"]);
    expect(Math.abs(fixed.indexOf("c") - fixed.indexOf("d"))).toBe(1);
  });

  it("东湖实例：湖西簇不再夹在湖东簇中间", () => {
    // 樱花园/楚天台/梅园在磨山（东岸），省博在湖西，吹笛在湖东
    const locs = [
      { id: "sakura", lat: 30.548, lng: 114.406 },
      { id: "chutian", lat: 30.5477, lng: 114.4071 },
      { id: "meiyuan", lat: 30.5483, lng: 114.4056 },
      { id: "shengbo", lat: 30.5614, lng: 114.3655 },
      { id: "chuidi", lat: 30.5767, lng: 114.4323 },
    ];
    const zigzag = ["sakura", "shengbo", "chuidi", "chutian", "meiyuan"];
    const fixed = minimizeOpenPath(zigzag, locs);
    const clusters: Record<string, number> = { sakura: 0, chutian: 0, meiyuan: 0, shengbo: 1, chuidi: 2 };
    // 同一簇内的点不应被另一簇的点隔开
    const groups = [fixed.indexOf("sakura"), fixed.indexOf("chutian"), fixed.indexOf("meiyuan")].sort((x, y) => x - y);
    expect(groups[2] - groups[0]).toBe(2);
    expect(clusters.shengbo).toBe(1);
    expect(pathM(fixed, locs)).toBeLessThan(pathM(zigzag, locs));
  });

  it("少于 4 站原样返回", () => {
    expect(minimizeOpenPath(["a", "b", "c"], [{ id: "a", lat: 0, lng: 0 }])).toEqual(["a", "b", "c"]);
  });

  it("无坐标站点追加在末尾且不参与优化", () => {
    const locs = [
      { id: "a", lat: 30.55, lng: 114.40 },
      { id: "b", lat: 30.552, lng: 114.402 },
      { id: "c", lat: 30.56, lng: 114.36 },
      { id: "d", lat: 30.561, lng: 114.362 },
    ];
    const out = minimizeOpenPath(["a", "c", "b", "d", "ghost"], locs);
    expect(out[out.length - 1]).toBe("ghost");
    expect(out.slice(0, 2)).toEqual(["a", "b"]);
    expect(Math.abs(out.indexOf("c") - out.indexOf("d"))).toBe(1);
  });

  it("同一片区的点连续游完，不被别的片区隔开", () => {
    // 磨山景区 4 点（相距 ~150m）+ 湖西 1 点 + 湖东 1 点
    const locs = [
      { id: "sakura", lat: 30.548, lng: 114.406 },
      { id: "chutian", lat: 30.5477, lng: 114.4071 },
      { id: "meiyuan", lat: 30.5483, lng: 114.4056 },
      { id: "zhiwuyuan", lat: 30.5468, lng: 114.4082 },
      { id: "shengbo", lat: 30.5614, lng: 114.3655 },
      { id: "chuidi", lat: 30.5767, lng: 114.4323 },
    ];
    const out = clusterOrderStops(["sakura", "shengbo", "chuidi", "chutian", "meiyuan", "zhiwuyuan"], locs);
    const moshan = ["sakura", "chutian", "meiyuan", "zhiwuyuan"].map(id => out.indexOf(id)).sort((a, b) => a - b);
    expect(moshan[3] - moshan[0]).toBe(3); // 磨山 4 点占据连续 4 个位置
    expect(out[0]).toBe("sakura"); // 入口最近点起步
  });

  it("orderStopsGeographic 的输出已是全局优化后的顺序", () => {
    const locs = [
      { id: "a", lat: 30.55, lng: 114.40 },
      { id: "b", lat: 30.552, lng: 114.402 },
      { id: "c", lat: 30.56, lng: 114.36 },
      { id: "d", lat: 30.561, lng: 114.362 },
    ];
    const ordered = orderStopsGeographic(["a", "c", "b", "d"], locs, null);
    expect(pathM(ordered, locs)).toBeLessThan(pathM(["a", "c", "b", "d"], locs));
    expect(ordered.slice(0, 2)).toEqual(["a", "b"]);
    expect(Math.abs(ordered.indexOf("c") - ordered.indexOf("d"))).toBe(1);
  });
});
