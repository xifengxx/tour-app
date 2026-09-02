import { haversineM } from "./geo.ts";

const CLUSTER_R = 8000;
const SUB_DEDUP_M = 300;

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
  const unifiedRegion30 = clusterRegionPts(locs, corePool).map((c) => pickRep(c, ctx.destName)).filter((l: any) => nearCore(l, 40000));
  const plans: { label: string; title: string; allow: string[] | null }[] = [];
  plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: corePool.slice(0, 8).map((l) => l.id) });
  if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...corePool.slice(0, 8).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  } else if (corePool.length >= 8) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: corePool.slice(0, 14).map((l) => l.id) });
  }
  if (ctx.hasRegionTour && unifiedRegion30.length) {
    plans.push({ label: "主题游", title: `${ctx.destName}深度主题游`, allow: [...corePool.slice(0, 4).map((l) => l.id), ...unifiedRegion30.map((l) => l.id)] });
  }
  if (ctx.isNovelBased) plans.push({ label: "文学巡礼线", title: `《${ctx.novelName}》文学巡礼`, allow: null });
  return plans;
}
