import { haversineM } from "./geo.ts";
import { isDestinationUmbrella, JUNK_RE } from "./gaode-scan.ts";
import { REGION_RADIUS } from "./anchors.ts";
import type { RouteZone } from "./route-knowledge-types.ts";
import type { TierCapabilities } from "./knowledge-tier.ts";

const CLUSTER_R = 8000;
const SUB_DEDUP_M = 300;
// 主景点数量不固定：少于上限时全保留，多于上限时按一日容量取前 10 个。
const CORE_ROUTE_MAX_STOPS = 10;
// 自动路线研究可能把同一核心标签扩散到远处的独立景点。常规徒步线必须以
// 目的地定位点为空间锚，防止“玉龙雪山”混入丽江古城或虎跳峡。
const CORE_ROUTE_RADIUS_M = 15000;
const ROAD_RE = /公路$|大道$|路$|街$|巷$/;

/**
 * 主题游的一个分区（v93）：一个可独立游览的景区 + 它内部具体可玩的点。
 *
 * 主题游过去和 1日/2日 用同一种形态——把一堆散点串成一条线，
 * 于是一条"主题游"里既有 28km 外的另一个景区又被写成连续行程，
 * 既不可行也读不出主题。新形态是两层结构：
 *   主题 → 若干就近可组合的景区 → 每个景区内部的具体玩法点。
 * 分区之间是"可以连着玩"的关系，不是一条步行动线。
 */
export type RouteSection = {
  key: string;
  name: string;
  kind: "核心景区" | "周边景点";
  allow: string[];
  note?: string;
};

type RoutePlan = {
  label: string;
  title: string;
  allow: string[] | null;
  preordered?: boolean;
  dayPlan?: { label: string; title: string; allow: string[] }[];
  /** 主题游专用：分区结构。allow 仍是扁平站点序列，保证旧消费方不破。 */
  sections?: RouteSection[];
};

const normalizeText = (value: unknown) =>
  String(value || "").toLowerCase().replace(/[，。、·—\-_\s（）()《》"]/g, "");

// 山岳景区常有“同属一个目的地，但必须分别乘索道/换乘”的分区。用知识层分区
// 把 1 日和 2 日拆开，比“核心池前 N 个 + 主景区后 N 个”更符合实际容量。
function zonePools(pool: any[], zones: RouteZone[]) {
  const pools = zones.map(zone => ({ zone, items: [] as any[] }));
  const directPools = zones.map(zone => ({ zone, items: [] as any[] }));
  const outside: any[] = [];
  for (const loc of pool) {
    const locName = normalizeText(loc.name);
    let best: { index: number; score: number } | null = null;
    for (let index = 0; index < zones.length; index++) {
      const zone = zones[index];
      for (const keyword of [zone.name, ...(zone.aliases || [])]) {
        const value = normalizeText(keyword);
        if (!value || !locName.includes(value)) continue;
        if (!best || value.length > best.score) best = { index, score: value.length };
      }
    }
    if (best) {
      pools[best.index].items.push(loc);
      directPools[best.index].items.push(loc);
    }
    else outside.push(loc);
  }

  // 白水河这类子景点不一定带分区名。若它贴近某个已识别分区，就归入该分区；
  // 归不进去的山麓文化点保留给第二天的外围段。
  for (const loc of outside.slice()) {
    if (!loc.lat || !loc.lng) continue;
    let best: { index: number; distance: number } | null = null;
    for (let index = 0; index < pools.length; index++) {
      const entry = directPools[index];
      for (const anchor of entry.items) {
        if (!anchor.lat || !anchor.lng) continue;
        const distance = haversineM(anchor, loc);
        if (distance <= 6000 && (!best || distance < best.distance)) {
          best = { index, distance };
        }
      }
    }
    if (best) {
      pools[best.index].items.push(loc);
      outside.splice(outside.indexOf(loc), 1);
    }
  }

  const byImp = (a: any, b: any) => (b.importance || 3) - (a.importance || 3);
  return {
    pools: pools.filter(entry => entry.items.length).map(entry => ({
      zone: entry.zone,
      items: entry.items.sort(byImp),
    })),
    outside: outside.sort(byImp),
  };
}

function zoneTitles(names: string[]) {
  const values = names.filter(Boolean);
  return values.join(" · ") || "景区游览";
}

function zoneSplitPlans(
  routeCorePool: any[],
  zones: RouteZone[],
  mainPool: any[],
  destName: string,
): RoutePlan[] {
  const { pools, outside } = zonePools(routeCorePool, zones);
  if (pools.length < 2) return [];
  const firstDay = [...pools[0].items.slice(0, 2), ...pools[1].items.slice(0, 3)].slice(0, 5).map(l => l.id);
  const secondDay = [
    ...pools.slice(2).flatMap(entry => entry.items.slice(0, 2)),
    ...outside.slice(0, 4),
    ...(mainPool.length ? mainPool.slice(0, 2) : []),
  ].slice(0, 6).map(l => l.id);
  if (secondDay.length < 2) return [];

  const dayPlan = [
    { label: "第1天", title: zoneTitles(pools.slice(0, 2).map(entry => entry.zone.name)), allow: firstDay },
    { label: "第2天", title: zoneTitles([...pools.slice(2).map(entry => entry.zone.name), "山麓延伸"]), allow: secondDay },
  ].filter(day => day.allow.length > 0);
  if (dayPlan.length < 2) return [];

  return [{
    label: "2日全景游",
    title: `${destName}两日全景游`,
    allow: dayPlan.flatMap(day => day.allow),
    preordered: true,
    dayPlan,
  }];
}

function clusterRegionPts(locs: any[], corePool: any[]) {
  const pts = locs.filter((l: any) => (l.tags || []).includes("地区景点") && !(l.tags || []).includes("景区泛指"))
    .filter((p: any) => !corePool.some((c: any) => haversineM(c, p) < SUB_DEDUP_M));
  const clusters: { rep: any; locs: any[] }[] = [];
  for (const p of pts) {
    const c = clusters.find((c) => haversineM(c.rep, p) < CLUSTER_R);
    if (c) c.locs.push(p);
    else clusters.push({ rep: p, locs: [p] });
  }
  return clusters;
}

/** 簇代表点名能否代表"一个景区"。地区景点合并后 importance 全是 3，
 * 单靠重要性无法区分，中文景区名后缀是最可靠的可读性信号。 */
function repTier(name: string): number {
  if (/风景名胜区$|景区$/.test(name)) return 3;
  if (/公园$|古镇$|古城$/.test(name)) return 2;
  if (/寺$|塔$|楼$|窟$|峡$|湖$/.test(name)) return 1;
  return 0;
}

function pickRep(cluster: { locs: any[] }, destName: string): any {
  const d2 = destName.slice(0, 2);
  return cluster.locs.slice().sort((a: any, b: any) =>
    (b.importance || 3) - (a.importance || 3)
    || repTier(String(b.name)) - repTier(String(a.name))
    || ((b.name.startsWith(d2) ? 1 : 0) - (a.name.startsWith(d2) ? 1 : 0))
    || (b.name.length - a.name.length)
  )[0];
}

export type PlanRoutesContext = {
  coreScenicName: string;
  mainScenicName: string;
  destName: string;
  destLoc?: { lng: number; lat: number } | null;
  isNovelBased: boolean;
  novelName: string;
  hasRegionTour: boolean;
  zones?: RouteZone[];
  /** 路线知识能力授权（缺省视为全部允许，兼容既有调用方与测试）。 */
  capabilities?: TierCapabilities;
  /** 因授权不足而**没有生成**的路线回调（只报真实缺失，选点降级不走这里）。 */
  onSuppressed?: (plan: string, reason: string) => void;
};

/**
 * 把"地区景点"按空间聚成可独立游览的景区分区（v93）。
 *
 * 复用 clusterRegionPts 已经算出的簇：它过去只保留每簇一个代表点，
 * 成员被丢掉，所以主题游退化成一串互不相关的散点。
 * 现在保留成员：一簇 = 一个景区，簇内的点就是"这个景区里具体玩什么"。
 */
export function buildThemeSections(
  locs: any[],
  ctx: { destName: string; coreScenicName?: string },
  corePool: any[],
  regionClusters: { rep: any; locs: any[] }[],
  limits: { maxSections?: number; maxPerSection?: number; maxTotal?: number } = {},
): RouteSection[] {
  const maxSections = limits.maxSections ?? 6;
  const maxPerSection = limits.maxPerSection ?? 6;
  const maxTotal = limits.maxTotal ?? 20;
  const byImp = (a: any, b: any) => (b.importance || 3) - (a.importance || 3);
  const coreIds = new Set(corePool.map((l: any) => l.id));
  const sections: RouteSection[] = [];
  let used = 0;

  if (corePool.length) {
    const ids = corePool.slice(0, Math.min(maxPerSection, 4)).map((l: any) => l.id);
    used += ids.length;
    sections.push({
      key: "core",
      name: ctx.coreScenicName || ctx.destName,
      kind: "核心景区",
      allow: ids,
    });
  }

  for (const cluster of regionClusters) {
    if (sections.length >= maxSections || used >= maxTotal) break;
    const rep = cluster.rep;
    // 成员 = 该景区内其他可玩点（同簇 8km 内）。代表点始终排在最前，
    // 它就是"这个景区"的名字；剩下按重要性列具体玩法点。
    const members = cluster.locs.filter((l: any) => l.id !== rep.id).sort(byImp);
    const ids = [rep.id, ...members.map((l: any) => l.id)]
      .filter((id, i, all) => all.indexOf(id) === i && !coreIds.has(id))
      .slice(0, maxPerSection);
    if (!ids.length) continue;
    used += ids.length;
    sections.push({ key: `area-${rep.id}`, name: rep.name, kind: "周边景点", allow: ids });
  }
  return sections;
}

export function planRoutes(locs: any[], ctx: PlanRoutesContext) {
  // v89：能力授权。缺省全开，只有显式传入 capabilities 时才收敛，
  // 避免这个改动在调用方接入前就改变既有行为。
  const caps: TierCapabilities = ctx.capabilities || {
    multiDay: true, themeTour: true, zoneDriven: true, trailOrder: true, assertTransport: true,
  };
  const suppress = (plan: string, reason: string) => ctx.onSuppressed?.(plan, reason);
  const canRoute = (l: any) => isRouteStopEligible(l, { destName: ctx.destName });
  const isRouteSite = (l: any) => canRoute(l) && !JUNK_RE.test(String(l.name || "")) && !ROAD_RE.test(String(l.name || ""));
  const isRegion = (l: any) => (l.tags || []).includes("地区景点");
  const byImp = (a: any, b: any) => (b.importance || 3) - (a.importance || 3);
  const corePool = locs.filter((l: any) => !isRegion(l) && l.scenic === ctx.coreScenicName).sort(byImp);
  // 锚点失败时不能产出空一日线：用所有非地区景点兜底，保住“必有常规路线”的底线。
  const rawCorePool = (corePool.length ? corePool : locs.filter((l: any) => !isRegion(l)).sort(byImp)).filter(isRouteSite);
  let mainPool = ctx.mainScenicName ? locs.filter((l: any) => l.scenic === ctx.mainScenicName).sort(byImp) : [];
  // 没有真实第二景区时不要用地区景点拼“两日全景”。这类 30km+ 的人文点属于主题游，
  // 混进山岳两日线会产生“下山→纪念馆→结束”的假接驳。
  // 泛指锚点可以保留在地图里，但不能拉偏核心景区几何中心；否则 60km 主题游筛选会误判。
  const routeableCore = corePool.filter(canRoute);
  const centerPool = routeableCore.length ? routeableCore : corePool;
  const coreCenter = centerPool.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
  const coreN = centerPool.length || 1;
  const cc = { lng: coreCenter.lng / coreN, lat: coreCenter.lat / coreN };
  const routeCenter = ctx.destLoc || cc;
  const coherentCorePool = rawCorePool.filter(l => haversineM(routeCenter, l) <= CORE_ROUTE_RADIUS_M);
  // v97：景区标签分组是整条管线里最脆的一环（AI 叫法、锚点清洗名、策展 zone 名
  // 三套语义，黄山线上实测 coreScenic 被 loose 匹配到"温泉景区"这种 1 点子区，
  // 一日精华游只剩 3 站）。当名称匹配的核心池不足 4 站时，退回数据本身的定义：
  // "目的地坐标 15km 内的全部非地区、可游览点"——这才是一日精华游的物理含义。
  if (coherentCorePool.length < 4 && ctx.destLoc) {
    const nearAll = locs.filter((l: any) => !isRegion(l)).filter(isRouteSite)
      .filter(l => haversineM(routeCenter, l) <= CORE_ROUTE_RADIUS_M).sort(byImp);
    if (nearAll.length > coherentCorePool.length) {
      coherentCorePool.length = 0;
      coherentCorePool.push(...nearAll);
    }
  }
  // 小景区可能只有 1-2 个坐标点；为避免过滤层反而清空常规路线，保留原兜底。
  const routeCorePool = coherentCorePool.length >= 3 ? coherentCorePool : rawCorePool;
  // v96.4：半径闸的圆心与核心池质心解耦。此前 nearCore 用 cc（核心池几何中心），
  // 当核心池因标签断裂为空时 cc≈(0,0)，整批地区点被 60km 闸杀光且 plans 静默只剩 1 条
  // （青城山线上实测）。与 coherentCorePool 对齐：优先目的地坐标。
  const nearCore = (l: any, maxM: number) => haversineM(routeCenter, l) <= maxM;
  if (mainPool.length) mainPool = mainPool.filter(l => isRouteSite(l) && nearCore(l, 35000));
  // 主题游的覆盖半径应与地区景点合并半径一致（60km）。此前只取 40km，
  // 会出现地点已入库（如应县木塔 47km、华严寺 60km）但没有任何路线引用的“孤岛地点”。
  const regionClusters = clusterRegionPts(locs, corePool);
  // 代表点只算一次并复用。此前 unifiedRegion60 用 pickRep(c)（按重要性挑簇代表），
  // 而 themeClusters 却拿 c.rep（建簇时最先插入的点）过滤——两个"代表"不是同一个点，
  // 东湖线上实测整个"黄鹤楼公园/昙华林/龟山/归元禅寺"市区簇静默消失，
  // 主题游只剩远郊木兰/园博园。身份必须一致。
  const clusterReps = regionClusters.map((c) => ({ c, rep: pickRep(c, ctx.destName) }));
  const unifiedRegion60 = clusterReps.map((x) => x.rep).filter((l: any) => isRouteSite(l) && nearCore(l, REGION_RADIUS));
  const plans: RoutePlan[] = [];
  if (ctx.zones?.length && caps.zoneDriven) {
    const { pools } = zonePools(routeCorePool, ctx.zones);
    const oneDay = pools.length >= 2
      ? [...pools[0].items.slice(0, 2), ...pools[1].items.slice(0, 3)].slice(0, 5)
      : routeCorePool.slice(0, 5);
    plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: oneDay.map((l) => l.id) });
  } else if (ctx.zones?.length && !caps.zoneDriven) {
    // 未核实的分区不能用来决定"这一天去哪几个点"。
    // 实测丽江玉龙雪山的 auto-research 把 13 个点全部归进"冰川公园"一个分区，
    // 分区机制形同虚设，却把 1 日线压到只剩 4 站。
    // 这不是"抑制路线"（1 日线照常产出），所以不走 onSuppressed，
    // 由调用方按 capabilities.zoneDriven 单独提示选点方式降级。
    plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: routeCorePool.slice(0, CORE_ROUTE_MAX_STOPS).map((l) => l.id) });
  } else {
    plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: routeCorePool.slice(0, CORE_ROUTE_MAX_STOPS).map((l) => l.id) });
  }
  if (!caps.multiDay) {
    if (ctx.zones?.length || mainPool.length) {
      suppress("2日全景游", "目的地路线知识未经核实，无法确认分区间换乘与第二天可达性");
    }
  } else if (ctx.zones?.length) {
    plans.push(...zoneSplitPlans(routeCorePool, ctx.zones, mainPool, ctx.destName));
  } else if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...routeCorePool.slice(0, CORE_ROUTE_MAX_STOPS).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  }
  if (!caps.themeTour) {
    if (ctx.hasRegionTour && unifiedRegion60.length) {
      suppress("主题游", "目的地路线知识未经核实，无法确认跨片区接驳可行性");
    }
  } else if (ctx.hasRegionTour && unifiedRegion60.length) {
    // v93：主题游改为"景区分组"而不是"散点连线"。
    // unifiedRegion60 仍决定哪些簇够格进主题游（已按目的地半径与可游览性过滤），
    // 这里把每簇的成员一并带上，形成 主题 → 景区 → 具体点 的两层结构。
    const eligible = new Set(unifiedRegion60.map((l: any) => l.id));
    const themeClusters = clusterReps.filter(x => eligible.has(x.rep.id)).map(x => ({ ...x.c, rep: x.rep }));
    const sections = buildThemeSections(locs, { destName: ctx.destName, coreScenicName: ctx.coreScenicName }, routeCorePool, themeClusters);
    const flat = sections.flatMap(sec => sec.allow);
    if (flat.length) {
      plans.push({
        label: "主题游", title: `${ctx.destName}深度主题游`,
        allow: flat, preordered: true, sections,
      });
    }
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

// ── 路线站点资格（v88）──────────────────────────────────────────────
// planRoutes 的 1日/2日/主题游池子本来就排除伞形景区名（canRoute），但文学巡礼线
// 走 AI 自由选点、resolveStop 又是名称双向包含匹配，会绕过这层过滤：
// 提到"黄山风景区"就能命中名为"黄山"的伞形 POI。线上数据里
// 泰山「泰山风景名胜区」、黄山「黄山」、天门山「天门山国家森林公园」都是这样进的路径，
// 它们的坐标是景区质心/行政点而非游览点，于是相邻站之间出现
// 「红门宫 → 泰山风景名胜区 7km/1295m」「森林公园 → 天门山索道 8.83km」这类假位移，
// 既污染交通衔接推断，也污染最近邻排序。
//
// 这里不能一刀切：策展步道会刻意用目的地名充当入口/换乘点
// （恒山首站「游客中心」的别名就是「北岳恒山」），删掉会让路线从山顶开始。
// 判据与全项目一致：已验证知识优先于启发式。

export type StopEligibilityContext = {
  destName: string;
  /** 策展步道站点名与别名（归一化后）；命中即视为已验证的入口/换乘点，保留。 */
  protectedNames?: Set<string>;
};

const normalizeStopName = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function isRouteStopEligible(loc: any, ctx: StopEligibilityContext): boolean {
  if (!loc) return false;
  const name = String(loc.name || "");
  const tags: string[] = loc.tags || [];
  const protectedNames = ctx.protectedNames;
  if (protectedNames?.has(normalizeStopName(name))) return true;
  if (tags.includes("景区泛指")) return false;
  if (isDestinationUmbrella(name, ctx.destName)) return false;
  return true;
}

/** 过滤站点序列，返回保留项与被剔除的点名（供告警展示）。未知 id 原样保留，交由上游匹配层处理。 */
export function filterRouteStops(
  stopIds: string[],
  locsById: Map<string, any>,
  ctx: StopEligibilityContext,
): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const id of stopIds) {
    const loc = locsById.get(id);
    if (!loc) { kept.push(id); continue; }
    if (isRouteStopEligible(loc, ctx)) kept.push(id);
    else dropped.push(String(loc.name || id));
  }
  return { kept, dropped };
}

/**
 * 把分区的 slug id 映射成写库用的 db id。
 *
 * planRoutes 产出的是 slug 空间（"h1"），而 routes.stops 存的是加过导览前缀的
 * db id（"77a10329-h1"）。这个映射是线上实测抓出来的 bug：
 * 之前直接拿 slug 去和 db id 求交集，结果恒为空，
 * 每个分区都被当成"没有站点"过滤掉，sections 落库永远是空数组。
 */
export function mapSectionsToDbIds(
  sections: RouteSection[] | undefined,
  slugToDbId: Map<string, string>,
  routeStopIds: string[],
): { key: string; name: string; kind: string; stopIds: string[] }[] {
  const inRoute = new Set(routeStopIds);
  return (sections || [])
    .map(sec => ({
      key: sec.key,
      name: sec.name,
      kind: sec.kind,
      stopIds: [...new Set((sec.allow || []).map(id => slugToDbId.get(id) || id))]
        .filter(id => inRoute.has(id)),
    }))
    .filter(sec => sec.stopIds.length > 0);
}
