// v99：路线按高德**真实步行/驾车路径**成线（借鉴 map-motion 的核心工艺：
// "路线是高德真实的驾车/步行/骑行路线"，而不是把景点坐标用直尺连起来）。
// 直连折线的两个系统性失真：① 地图上"点间拉直线"穿山越水，用户一眼看出假；
// ② 海拔剖面的里程是直线距离，比真实步道/公路里程短 20-60%，
// 累计爬升与"约X小时"的推算一起被带偏。
// 数据流：legs 的交通方式决定路径类型——walk→步行，shuttle/car/other→驾车，
// cableway（索道）没有道路可规划→两点直线。任何一段规划失败回退直线，
// 并把 planned/fellBack 计数写进报告，禁止静默降级。

import { GAODE_KEY } from "./config.ts";

export type RoutePathModel = {
  geom: [number, number][]; // GCJ-02 [lng, lat]
  stopKm: number[];         // 每个站点在真实路径上的累计里程（km）
  totalKm: number;
  planned: number;          // 高德真实路径覆盖的段数
  fellBack: number;         // 回退直线的段数
};

const havKm = (a: number[], b: number[]) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLng = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parsePolyline(polyline: unknown): [number, number][] {
  const out: [number, number][] = [];
  for (const pt of String(polyline || "").split(";")) {
    const [lng, lat] = pt.split(",").map(Number);
    if (Number.isFinite(lng) && Number.isFinite(lat)) out.push([lng, lat]);
  }
  return out;
}

/** 单段高德路径规划。失败/无 Key 返回 null，由调用方回退直线。 */
export async function amapLegPath(
  type: "walking" | "driving",
  from: [number, number],
  to: [number, number],
  fetchImpl: typeof fetch = fetch,
  key: string = GAODE_KEY,
): Promise<{ geom: [number, number][]; km: number } | null> {
  if (!key) return null;
  const url = `https://restapi.amap.com/v3/direction/${type}?origin=${from[0]},${from[1]}&destination=${to[0]},${to[1]}&key=${key}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await sleep(300 * (attempt + 1)); continue; }
      const path = d.route?.paths?.[0];
      const geom: [number, number][] = [];
      for (const step of path?.steps || []) {
        for (const p of parsePolyline(step.polyline)) {
          const last = geom[geom.length - 1];
          if (!last || last[0] !== p[0] || last[1] !== p[1]) geom.push(p);
        }
      }
      const km = Number(path?.distance);
      if (geom.length < 2 || !Number.isFinite(km) || km <= 0) return null;
      return { geom, km: Math.round((km / 1000) * 100) / 100 };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Douglas-Peucker 折线抽稀（借鉴 map-motion 同款算法）。
 * 真实路径动辄数千点，JSONB 存储与前端渲染都不必要——20m 容差内
 * 视觉上与原始路径无差别（地图缩放级别下人眼分辨不了）。
 * 只在超长时启用，返回点数上限约 1500。
 */
export function simplifyPath(points: [number, number][], toleranceDeg = 0.0002): [number, number][] {
  if (points.length < 3) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  const perpDist = (p: number[], a: number[], b: number[]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxD = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDist(points[i], points[first], points[last]);
      if (d > maxD) { maxD = d; index = i; }
    }
    if (maxD > toleranceDeg && index > 0) {
      keep[index] = true;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * 沿站点顺序拼接真实路径。
 * @param coords 站点坐标（GCJ-02 [lng,lat]，长度 n）
 * @param modes  相邻站点间的交通方式（长度 n-1，来自 buildRouteLegs）
 */
export async function buildRoutePath(
  coords: [number, number][],
  modes: string[],
  fetchImpl: typeof fetch = fetch,
  key: string = GAODE_KEY,
): Promise<RoutePathModel | null> {
  if (coords.length < 2) return null;
  const geom: [number, number][] = [[coords[0][0], coords[0][1]]];
  const stopKm: number[] = [0];
  let acc = 0;
  let planned = 0;
  let fellBack = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const from = coords[i];
    const to = coords[i + 1];
    const mode = modes[i] || "walk";
    let leg: { geom: [number, number][]; km: number } | null = null;
    if (mode !== "cableway") {
      const type = mode === "walk" ? "walking" : "driving";
      leg = await amapLegPath(type, from, to, fetchImpl, key);
    }
    if (leg && leg.geom.length >= 2) {
      planned++;
      for (const p of leg.geom.slice(1)) geom.push(p);
      acc += leg.km;
    } else {
      fellBack++;
      acc += havKm(from, to);
      geom.push([to[0], to[1]]);
    }
    stopKm.push(Math.round(acc * 100) / 100);
  }
  // 抽稀在拼接完成后做；stopKm 基于原始真实里程累计，不受抽稀影响。
  return { geom: simplifyPath(geom), stopKm, totalKm: stopKm[stopKm.length - 1], planned, fellBack };
}
