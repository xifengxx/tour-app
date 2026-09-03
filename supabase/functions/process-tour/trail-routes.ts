import { haversineM } from "./geo.ts";
import { landmarkKey } from "./gaode-scan.ts";
import type { TrailRoute, TrailStop } from "./route-knowledge-types.ts";

export type { TrailRoute, TrailStop } from "./route-knowledge-types.ts";

// 知名山岳的实际游览顺序比“地理最近邻”更接近真实动线。这里保存低频更新的
// 策展快照，而不是在 Edge Function 里实时抓网页：60s 函数预算和反爬都不稳定。
// 坐标只用于消歧和缺失点补全；生产仍以高德坐标/区域校验为准。
export const CURATED_TRAILS: TrailRoute[] = [
  {
    aliases: ["泰山", "泰山风景名胜区", "泰安泰山"],
    stops: [
      { name: "红门", aliases: ["红门宫", "红门游客中心"] },
      { name: "一天门" },
      { name: "万仙楼" },
      { name: "斗母宫" },
      { name: "经石峪" },
      { name: "中天门" },
      { name: "五大夫松" },
      { name: "十八盘" },
      { name: "南天门" },
      { name: "天街" },
      { name: "碧霞祠", aliases: ["碧霞元君祠"] },
      { name: "玉皇顶" },
      { name: "日观峰" },
    ],
    notes: "经典红门徒步线：红门→中天门→十八盘→南天门→天街→碧霞祠→玉皇顶；中天门/南天门可索道分段。",
  },
  {
    aliases: ["华山", "西岳华山", "华山风景名胜区"],
    stops: [
      { name: "玉泉院" },
      { name: "千尺幢" },
      { name: "百尺峡" },
      { name: "老君犁沟" },
      { name: "北峰" },
      { name: "苍龙岭" },
      { name: "金锁关" },
      { name: "东峰" },
      { name: "南峰" },
      { name: "西峰" },
    ],
    notes: "徒步参考“自古华山一条路”：玉泉院→北峰→金锁关→东南西峰；索道常见西上北下。",
  },
  {
    aliases: ["北岳恒山", "恒山", "恒山风景名胜区", "大同恒山"],
    stops: [
      { name: "游客中心", aliases: ["北岳恒山", "恒山"] },
      { name: "三清殿", aliases: ["恒山三清殿"], lat: 39.651853, lng: 113.725842, required: true },
      { name: "三元宫", lat: 39.651753, lng: 113.72432 },
      { name: "真武庙", aliases: ["真武殿"], lat: 39.662628, lng: 113.734905, required: true },
      { name: "虎风口", lat: 39.665722, lng: 113.733802, required: true },
      { name: "果老岭", aliases: ["果老先迹", "北岳恒山-果老岭"], lat: 39.667709, lng: 113.73262, required: true },
      { name: "苦甜井" },
      { name: "崇灵门" },
      { name: "会仙府", lat: 39.670322, lng: 113.732116, required: true },
      { name: "琴棋台" },
      { name: "天峰岭", lat: 39.672792, lng: 113.732809, required: true },
      { name: "悬空寺", lat: 39.661139, lng: 113.715781, required: true },
      { name: "金龙峡", aliases: ["金龙峡栈道"], lat: 39.664756, lng: 113.713587 },
      { name: "翠屏山", aliases: ["翠屏山-三清殿", "翠屏山三清殿"], lat: 39.665923, lng: 113.707197 },
    ],
    notes: "恒山主游线按实际换乘组织：游客中心/山脚三清殿→真武庙→虎风口→果老岭→会仙府→天峰岭；下山后专车到悬空寺/金龙峡。",
  },
  {
    aliases: ["南岳衡山", "衡山", "南岳衡山风景名胜区"],
    stops: [
      { name: "南岳大庙" },
      { name: "忠烈祠" },
      { name: "半山亭" },
      { name: "磨镜台" },
      { name: "福严寺" },
      { name: "南台寺" },
      { name: "南天门" },
      { name: "上封寺" },
      { name: "祝融峰" },
    ],
    notes: "经典上行参考：南岳大庙/胜利坊→忠烈祠→半山亭→磨镜台/福严寺→南天门→上封寺→祝融峰。",
  },
  {
    aliases: ["嵩山", "中岳嵩山", "太室山"],
    scenicName: "太室山",
    stops: [
      { name: "嵩阳书院" },
      { name: "老母洞" },
      { name: "中岳行宫" },
      { name: "三皇口" },
      { name: "峻极峰", aliases: ["太室山", "太室山主峰"] },
    ],
    notes: "太室山经典线：嵩阳书院→老母洞→中岳行宫→三皇口→峻极峰。",
  },
  {
    aliases: ["嵩山", "少室山", "三皇寨", "少林寺"],
    scenicName: "少室山",
    stops: [
      { name: "少林寺" },
      { name: "塔林" },
      { name: "三皇寨" },
      { name: "悬空栈道" },
    ],
    notes: "少室山景区线：少林寺/塔林与三皇寨/悬空栈道分属同一游览区，但需按索道或徒步衔接，不与太室山峻极峰混排。",
  },
];

const normalizeName = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[，。、·—\-_\s（）()《》"]/g, "");

const hasCoords = (loc: LocLike | undefined): loc is LocLike & { lat: number; lng: number } =>
  typeof loc?.lat === "number" && typeof loc?.lng === "number";

const trailAliases = (stop: TrailStop) => [stop.name, ...(stop.aliases || [])].map(normalizeName).filter(Boolean);

const isDestinationTrail = (route: TrailRoute, destName: string) => {
  const target = normalizeName(destName);
  return route.aliases.some(alias => target.includes(normalizeName(alias)) || normalizeName(alias).includes(target));
};

type LocLike = { id: string; name?: string; lat?: number; lng?: number };

function scoreCandidate(loc: LocLike, stop: TrailStop) {
  const locName = normalizeName(loc.name);
  if (!locName) return null;
  let bestName = -1;
  for (const alias of trailAliases(stop)) {
    if (locName === alias) bestName = Math.max(bestName, 2);
    else if (locName.endsWith(alias)) bestName = Math.max(bestName, 1);
    else if (locName.includes(alias)) bestName = Math.max(bestName, 0.5);
  }
  if (bestName < 0) return null;
  const distance = stop.lat && stop.lng && loc.lat && loc.lng
    ? haversineM({ lat: stop.lat, lng: stop.lng }, loc as any)
    : null;
  // “翠屏山-三清殿”这类同名异景点必须让坐标参与裁决，否则会污染恒山主游线。
  if (distance != null && distance > 4000) return null;
  return { score: bestName - (distance == null ? 0 : distance / 100000), distance };
}

function matchStops(route: TrailRoute, locs: LocLike[]) {
  const used = new Set<string>();
  const matches = new Map<number, LocLike>();
  for (const stop of route.stops) {
    const candidates = locs
      .map(loc => ({ loc, score: scoreCandidate(loc, stop) }))
      .filter((c): c is { loc: LocLike; score: NonNullable<ReturnType<typeof scoreCandidate>> } => !!c.score && !used.has(c.loc.id))
      .sort((a, b) => b.score.score - a.score.score || a.score.distance! - b.score.distance!);
    const hit = candidates[0];
    if (hit) {
      matches.set(route.stops.indexOf(stop), hit.loc);
      used.add(hit.loc.id);
    }
  }
  return { matches, used };
}

function selectTrail(destName: string, locs: LocLike[], trails: TrailRoute[] = CURATED_TRAILS) {
  let best: { route: TrailRoute; matches: Map<number, LocLike>; score: number } | null = null;
  for (const route of trails) {
    if (!isDestinationTrail(route, destName)) continue;
    const { matches } = matchStops(route, locs);
    const score = matches.size * 2 + route.stops.filter(s => s.required).length;
    if (matches.size >= 2 && (!best || score > best.score)) best = { route, matches, score };
  }
  return best;
}

// 缺失关键点用策展坐标补进核心池。它发生在高德定位和区域校验之后，属于最后一层兜底；
// 只补有坐标且 required 的站点，避免把“苦甜井”这类不确定点写进导览。
export function injectTrailSeeds(
  locs: any[],
  destName: string,
  coreScenicName: string,
  trails: TrailRoute[] = CURATED_TRAILS,
): string[] {
  const selected = selectTrail(destName, locs, trails);
  if (!selected) return [];
  const added: string[] = [];
  for (const stop of selected.route.stops) {
    if (!stop.required || !stop.lat || !stop.lng) continue;
    // 语义键必须先于模糊名称匹配。“武功山风景名胜区金顶”和“金顶”是同一地标；
    // 而“武功山金顶帐篷”只是营地，不能因名称包含“金顶”就抢走或复刻金顶站点。
    const stopKeys = trailAliases(stop).map(alias => landmarkKey(alias, destName)).filter(Boolean);
    const semanticHit = locs.some(l => {
      const locKey = landmarkKey(l.name, destName);
      return !!locKey && stopKeys.includes(locKey);
    });
    if (semanticHit || locs.some(l => scoreCandidate(l, stop))) continue;
    const id = `trail-${locs.length}`;
    locs.push({
      id,
      name: stop.name,
      lat: stop.lat,
      lng: stop.lng,
      elevation: "",
      importance: 4,
      tags: ["子景点", "路线补全"],
      layers: {},
      reflection: "",
      practical: {},
      scenic: coreScenicName,
      sort_order: locs.length,
    });
    added.push(stop.name);
  }
  return added;
}

// 嵩山这类目的地不是一条线性步道：太室山和少室山分别徒步，一天不可能混爬。
// 这里不生成路线，只把已有真实站点归到策展景区池；路线组成仍交给 planRoutes。
export function applyTrailGroups(locs: any[], destName: string, trails: TrailRoute[] = CURATED_TRAILS): string[] {
  const changed: string[] = [];
  const matchedRoutes = trails.filter(route => route.scenicName && isDestinationTrail(route, destName));
  for (const route of matchedRoutes) {
    if (!route.scenicName || !isDestinationTrail(route, destName)) continue;
    const { matches } = matchStops(route, locs);
    if (matches.size < 2) continue;
    for (const matched of matches.values()) {
      const loc = locs.find(l => l.id === matched.id);
      if (loc && loc.scenic !== route.scenicName) {
        loc.scenic = route.scenicName;
        changed.push(`${loc.name}→${route.scenicName}`);
      }
    }
    // AI/高德可能返回“少室山碑”这类未收录但语义明确的名称。按景区名做关键词兜底，
    // 避免少室山侧的点再落回嵩山核心池，混入太室山一日爬线。
    for (const loc of locs) {
      const locName = normalizeName(loc.name);
      if (!locName || !locName.includes(normalizeName(route.scenicName!))) continue;
      if (loc.scenic !== route.scenicName) {
        loc.scenic = route.scenicName;
        changed.push(`${loc.name}→${route.scenicName}`);
      }
    }
  }
  // 双山目的地里，未带“太室山/少室山”字样的核心人文点仍属于第一个主徒步区。
  // 若不归组，它们会留在“嵩山”伞形池，把一日线变成太室山+少室山混合路线。
  if (matchedRoutes.length > 1) {
    const primaryScenicName = matchedRoutes[0].scenicName!;
    const groupedIds = new Set(locs.filter(l => matchedRoutes.some(r => l.scenic === r.scenicName)).map(l => l.id));
    for (const loc of locs) {
      if (groupedIds.has(loc.id) || (loc.tags || []).includes("地区景点")) continue;
      if (loc.scenic !== primaryScenicName) {
        loc.scenic = primaryScenicName;
        changed.push(`${loc.name}→${primaryScenicName}`);
      }
    }
  }
  return changed;
}

// 双山目的地不能再用“嵩山”这个伞形景区当天池，否则 planRoutes 在核心池为空时
// 会退回“全部非地区景点”，一日线又混入少室山。这里给出第一个真实徒步区。
export function getPrimaryTrailScenicName(destName: string, trails: TrailRoute[] = CURATED_TRAILS): string | null {
  const matchedRoutes = trails.filter(route => route.scenicName && isDestinationTrail(route, destName));
  // 单条已知路线也要接管核心池命名。否则“萍乡武功山国家级风景名胜区”这类
  // 伞形锚点会变成 coreScenicName，而真实步道点反而留在另一个 scenic 池。
  return matchedRoutes[0]?.scenicName || null;
}

export function getTrailNotes(destName: string, locs: LocLike[], trails: TrailRoute[] = CURATED_TRAILS) {
  return selectTrail(destName, locs, trails)?.route.notes || "";
}

export function orderStopsByTrail(
  stopIds: string[],
  locs: any[],
  entrance: { lng: number; lat: number } | null | undefined,
  destName: string,
  trails: TrailRoute[] = CURATED_TRAILS,
): string[] {
  const byId = new Map(locs.map(l => [l.id, l]));
  const selected = selectTrail(destName, locs.filter(l => stopIds.includes(l.id)), trails);
  if (!selected) return [];
  const routeOrder = selected.route.stops
    .map((_, index) => ({ id: selected.matches.get(index)?.id, index }))
    .filter((hit): hit is { id: string; index: number } => !!hit.id && stopIds.includes(hit.id));
  const unmatched = stopIds.filter(id => !routeOrder.some(hit => hit.id === id));
  const ordered: string[] = [];
  for (const { id, index } of routeOrder) {
    ordered.push(id);
    const nextTrailLoc = selected.route.stops
      .slice(index + 1)
      .map((_, offset) => selected.matches.get(index + 1 + offset))
      .find(Boolean);
    const near = unmatched.filter(uid => {
      const u = byId.get(uid);
      const anchor = byId.get(id);
      const next = nextTrailLoc;
      if (!hasCoords(u) || !hasCoords(anchor)) return false;
      return !next || (hasCoords(next) && haversineM(u, anchor) <= haversineM(u, next));
    });
    for (const uid of near) {
      ordered.push(uid);
      unmatched.splice(unmatched.indexOf(uid), 1);
    }
  }
  // 嵩山等双山目的地的 2日线可能同时包含两个策展段。若仍按单条线排序，
  // 会产生“少林寺→太室山→塔林”这种跨山往返；这里先把同一 trail 匹配到的段
  // 排好，再按 stopIds 的原始出现顺序拼接（planRoutes 中通常就是“核心段+主景区段”）。
  if (routeOrder.length && routeOrder.length < stopIds.length) {
    const groups: { scenicName?: string; ids: string[] }[] = [];
    const assigned = new Set<string>();
    for (const route of trails) {
      if (!isDestinationTrail(route, destName)) continue;
      const { matches } = matchStops(route, locs.filter(l => stopIds.includes(l.id) && !assigned.has(l.id)));
      if (matches.size < 2) continue;
      const ids = route.stops
        .map((_, index) => matches.get(index)?.id)
        .filter((id): id is string => !!id && stopIds.includes(id) && !assigned.has(id));
      const routeIds = new Set(ids);
      for (const id of stopIds.filter(id => !assigned.has(id) && !routeIds.has(id) && byId.get(id)?.scenic === route.scenicName)) ids.push(id);
      if (!ids.length) continue;
      for (const id of ids) assigned.add(id);
      groups.push({ scenicName: route.scenicName, ids });
    }
    if (groups.length > 1) {
      const remaining = stopIds.filter(id => !assigned.has(id));
      // CURATED_TRAILS 已按“太室山在前、少室山在后”编排，避免按 stopIds 首个匹配
      // 又把少室山段插到太室山段前面。
      return [...groups.flatMap(group => group.ids), ...remaining];
    }
  }
  for (const uid of unmatched) ordered.push(uid);
  return ordered;
}
