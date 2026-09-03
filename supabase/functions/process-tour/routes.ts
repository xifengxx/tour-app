import { haversineM } from "./geo.ts";
import { REGION_RADIUS } from "./anchors.ts";

const CLUSTER_R = 8000;
const SUB_DEDUP_M = 300;
// 主景点数量不固定：少于上限时全保留，多于上限时按重要性取前 20 个。
const CORE_ROUTE_MAX_STOPS = 20;

function clusterRegionPts(locs: any[], corePool: any[]) {
  const pts = locs.filter((l: any) => (l.tags || []).includes("地区景点"))
    .filter((p: any) => !corePool.some((c: any) => haversineM(c, p) < SUB_DEDUP_M));
  const clusters: { rep: any; locs: any[] }[] = [];
  for (const p of pts) {
    const c = clusters.find((c) => haversineM(c.rep, p) < CLUSTER_R);
    if (c) c.locs.push(p);
    else clusters.push({ rep: p, locs: [p] });
  }
  return clusters;
}

function pickRep(cluster: { locs: any[] }, destName: string): any {
  const d2 = destName.slice(0, 2);
  return cluster.locs.slice().sort((a: any, b: any) =>
    (b.importance || 3) - (a.importance || 3)
    || ((b.name.startsWith(d2) ? 1 : 0) - (a.name.startsWith(d2) ? 1 : 0))
    || (a.name.length - b.name.length)
  )[0];
}

export function planRoutes(locs: any[], ctx: { coreScenicName: string; mainScenicName: string; destName: string; isNovelBased: boolean; novelName: string; hasRegionTour: boolean }) {
  const isRegion = (l: any) => (l.tags || []).includes("地区景点");
  const byImp = (a: any, b: any) => (b.importance || 3) - (a.importance || 3);
  const corePool = locs.filter((l: any) => !isRegion(l) && l.scenic === ctx.coreScenicName).sort(byImp);
  // 锚点失败时不能产出空一日线：用所有非地区景点兜底，保住“必有常规路线”的底线。
  const routeCorePool = corePool.length ? corePool : locs.filter((l: any) => !isRegion(l)).sort(byImp);
  let mainPool = ctx.mainScenicName ? locs.filter((l: any) => l.scenic === ctx.mainScenicName).sort(byImp) : [];
  if (!mainPool.length) {
    const clusters = clusterRegionPts(locs, corePool);
    const big = clusters.slice().sort((a, b) => b.locs.length - a.locs.length)[0];
    mainPool = big && big.locs.length >= 2 ? big.locs : [];
  }
  const coreCenter = corePool.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
  const coreN = corePool.length || 1;
  const cc = { lng: coreCenter.lng / coreN, lat: coreCenter.lat / coreN };
  const nearCore = (l: any, maxM: number) => haversineM(cc, l) <= maxM;
  if (mainPool.length) mainPool = mainPool.filter(l => nearCore(l, 35000));
  // 主题游的覆盖半径应与地区景点合并半径一致（60km）。此前只取 40km，
  // 会出现地点已入库（如应县木塔 47km、华严寺 60km）但没有任何路线引用的“孤岛地点”。
  const unifiedRegion60 = clusterRegionPts(locs, corePool).map((c) => pickRep(c, ctx.destName)).filter((l: any) => nearCore(l, REGION_RADIUS));
  const plans: { label: string; title: string; allow: string[] | null }[] = [];
  plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: routeCorePool.slice(0, CORE_ROUTE_MAX_STOPS).map((l) => l.id) });
  if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...routeCorePool.slice(0, CORE_ROUTE_MAX_STOPS).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  }
  if (ctx.hasRegionTour && unifiedRegion60.length) {
    plans.push({ label: "主题游", title: `${ctx.destName}深度主题游`, allow: [...routeCorePool.slice(0, 4).map((l) => l.id), ...unifiedRegion60.map((l) => l.id)] });
  }
  if (ctx.isNovelBased) plans.push({ label: "文学巡礼线", title: `《${ctx.novelName}》文学巡礼`, allow: null });
  return plans;
}

// v71: 站内顺序确定性地理排序。AI 拿不到坐标、屡次产出"山顶→山脚→山顶"锯齿动线（恒山实测），
// 改为最近邻串联：以最接近目的地定位点（通常为入口/游客中心）的站点起步，依次走向最近的未访问站点。
// 无坐标的站点保持原相对顺序追加在末尾。
export function orderStopsGeographic(stopIds: string[], locs: any[], entrance?: { lng: number; lat: number } | null): string[] {
  if (stopIds.length <= 2) return stopIds;
  const byId = new Map(locs.map((l: any) => [l.id, l]));
  let cur: string | null = null;
  const remaining = new Set(stopIds);
  if (entrance) {
    let bestD = Infinity;
    for (const id of remaining) {
      const l = byId.get(id);
      if (!l) continue;
      const d = haversineM(l, entrance);
      if (d < bestD) { bestD = d; cur = id; }
    }
  }
  if (!cur || !byId.has(cur)) cur = stopIds.find(id => byId.has(id)) || null;
  const ordered: string[] = [];
  const noCoord = stopIds.filter(id => !byId.has(id));
  for (const id of noCoord) remaining.delete(id);
  while (cur && remaining.size) {
    remaining.delete(cur);
    ordered.push(cur);
    const a = byId.get(cur)!;
    let best: string | null = null;
    let bestD = Infinity;
    for (const id of remaining) {
      const b = byId.get(id);
      if (!b) continue;
      const d = haversineM(a, b);
      if (d < bestD) { bestD = d; best = id; }
    }
    cur = best;
  }
  if (remaining.size) ordered.push(...remaining);
  return [...ordered, ...noCoord];
}
