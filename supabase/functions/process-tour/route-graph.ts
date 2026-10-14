import { haversineM } from "./geo.ts";
import { isNonSitePOI } from "./poi-filter.ts";
import type { DestinationRouteKnowledge, RouteEdge } from "./route-knowledge-types.ts";

const normalizeName = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[，。、·—\-_\s（）()《》"]/g, "");

/**
 * 设施后缀剥离（v92）。目的地知识里的节点常写成“景区名 + 设施词”：
 * 「蓝月谷游览车-候车厅」「牦牛坪下部站」「玉龙雪山游客服务中心」。
 * 而实际入库的游览点叫「蓝月谷」「牦牛坪」，两侧都包含关系不成立，
 * 于是知识里写好的交通边一条都连不上（实测玉龙雪山 21 站只绑上 2 站）。
 *
 * 只剥"确定的设施词"，不做任意包含匹配：
 * 「武功山金顶帐篷」剥不掉"帐篷"（不在表内），因此不会冒充"金顶"，
 * 这正是历史上专门防过的一类误配。
 */
const FACILITY_SUFFIX_RE = /(?:游览车|观光车|接驳车|索道|缆车)?[-—\s]?(?:候车厅|候车区|候车点|候车室|下部站|上部站|中部站|中站|上站|下站|导览驿站|驿站|服务站|游客服务中心|游客中心|服务中心|售票处|售票点|检票口|换乘点|站台)$/;

export function stripFacilitySuffix(value: unknown): string {
  const raw = normalizeName(value);
  if (!raw) return "";
  const stripped = raw.replace(FACILITY_SUFFIX_RE, "").trim();
  // 剥离后过短（少于 2 字）会退化成"蓝""谷"这类无意义键，宁可不用
  return stripped.length >= 2 && stripped !== raw ? stripped : "";
}

// 高德/AI 常把交通设施并入景点名（例如“紫极宫(中庵)”对应“中庵索道”）。
// 图节点保留资料原名，同时派生常用短别名，让显式交通边可以命中实际站点。
function implicitNodeAliases(value: unknown) {
  const name = String(value || "").trim();
  const aliases = new Set<string>();
  if (/游客服务中心/.test(name)) aliases.add(name.replace(/游客服务中心/g, "游客中心"));
  if (/游客中心/.test(name)) aliases.add(name.replace(/游客中心/g, "游客服务中心"));
  if (/索道/.test(name)) {
    const shortAlias = name.replace(/索道/g, "").trim();
    if (shortAlias) aliases.add(shortAlias);
  }
  return [...aliases].filter(Boolean);
}

type GraphNode = {
  key: string;
  name: string;
  aliases: string[];
  lat?: number;
  lng?: number;
  trailIds: Set<string>;
  zoneIds: Set<string>;
};

export type RouteGraph = {
  nodes: Map<string, GraphNode>;
  edges: Map<string, RouteEdge>;
};

export type RouteGraphIssue = {
  type: "zone-interleaved" | "trail-backtrack" | "long-transfer" | "long-day";
  message: string;
  /**
   * blocking = 路线本身不成立，闸门必须拦下（结构错乱、行程超容量、跨片区硬伤）。
   * advisory = 目的地资料缺失或与物理量不一致，系统已按物理量推断出可用方案，
   *            需要创作者核实但不该阻断发布。
   * 这个区分是闸门能否上线的前提：把"资料未覆盖"也当阻断，
   * 那么每一个新目的地（必然没有知识）都会被拦死，闸门就成了禁用开关。
   */
  level?: "blocking" | "advisory";
};

/** 单段直线超过该值且不是主题游时，按物理量判定为跨片区硬伤。 */
export const HARD_TRANSFER_M = 30000;

export type RouteGraphOptions = {
  // 主题游本来就串联核心景区和 60km 内的独立景点；长距离换乘是预期行为。
  allowLongTransfers?: boolean;
  longTransferM?: number;
  dayLabel?: string;
  maxDailyHours?: number;
  /**
   * 显式天数，优先于从 dayLabel 里正则猜。
   * 主题游是"几个可连着玩的景区"，每个景区自成一日，
   * 按 1 日容量去校验会把正常的分组行程全判成超容量。
   */
  dayCount?: number;
};

export type RouteGraphSegment = {
  zoneId: string;
  zoneName: string;
  trailIds: string[];
  stopIds: string[];
};

export type RouteLeg = {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  mode: RouteEdge["mode"];
  duration?: string;
  note?: string;
  distanceM?: number;
  // P1-3: 直线里程换算出的山路里程与保守车程分钟数，供容量校验与审核页展示。
  roadKm?: number;
  roadMinutes?: number;
  // 资料边的原始方式，用于审核页显示"资料说步行、实测需乘车"这类冲突。
  edgeMode?: RouteEdge["mode"];
  // 该边是否只是 trail 顺序默认生成的 walk（资料并未主张这里是步行）。
  edgeSynthetic?: boolean;
  // true = 该方式完全由直线距离推断，目的地知识里没有对应交通边，属于未经核实的推断。
  inferred?: boolean;
  // 相邻站点高差（米），来自 locations.elevation；任一缺失时为 undefined。
  elevationDeltaM?: number;
};

export type RouteDurationEstimate = {
  movementMinutes: number;
  visitMinutes: number;
  totalMinutes: number;
  estimatedLegs: number;
};

const MODE_TEXT: Record<RouteEdge["mode"], string> = {
  walk: "徒步",
  cableway: "索道",
  shuttle: "观光车/摆渡车",
  car: "专车/出租车",
  other: "接驳交通",
};

// P1-3: 直线距离只是"可达性"的粗糙代理，绝不能直接映射成"景区观光车"。
// 山地景区之间直线 15km 可能是 2 小时盘山车程（丽江玉龙雪山↔香格里拉虎跳峡
// 直线 36.7km、实际约 2.3 小时），把它标成 shuttle 会让 narrative 写出
// "乘景区观光车直线约 37 公里"这类游客可见的错误指引。
// 因此按直线里程分层，并为每一层设定"最低交通方式"（mode floor）。
export const WALK_MAX_M = 3000;              // 站内/相邻景点，可徒步
export const SCENIC_SHUTTLE_MAX_M = 12000;   // 景区内部摆渡的合理上限
export const MOUNTAIN_ROAD_KMH = 30;         // 山区公路保守均速（含等候与绕行）
export const ROAD_DETOUR_FACTOR = {
  walk: 1.3, cableway: 1.0, shuttle: 1.6, car: 1.9, other: 1.6,
} as const;

// 给定直线距离，返回"至少要用什么交通方式"。distanceM 为 null 时保守走徒步。
export function inferTransferMode(distanceM: number | null | undefined): RouteEdge["mode"] {
  if (distanceM == null || !Number.isFinite(distanceM)) return "walk";
  if (distanceM <= WALK_MAX_M) return "walk";
  if (distanceM <= SCENIC_SHUTTLE_MAX_M) return "shuttle";
  return "car";
}

// 交通方式的"机动化程度"排序。资料边方式与距离下限取更严格的一方，
// 这样 auto-research 把 20km 跨片区位移标成 walk 时不会直接进 narrative。
const MODE_RANK: Record<RouteEdge["mode"], number> = {
  walk: 0, cableway: 1, shuttle: 1, other: 1, car: 2,
};

export function rankMode(a: RouteEdge["mode"], b: RouteEdge["mode"]): RouteEdge["mode"] {
  return MODE_RANK[a] >= MODE_RANK[b] ? a : b;
}

// 山地景区里"平面距离近"不等于"走得动"：泰山日观峰(1536m)→岱庙(150m)
// 直线只有 7.12km，但 1386m 落差意味着这必须索道+车下山，绝不能当连续徒步。
// 原实现只看平面距离（阈值 8km），所以这条假阴性永远报不出来。
// 地点海拔来自 AI 提取的 locations.elevation（形如 "1545m"），缺失时退化为纯距离判定。
export const MAX_ELEVATION_DELTA_M = 3000;

export function parseElevationM(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const hasUnit = /(m|米|海拔|masl)/i.test(text);
  // 纯数字或数字区间（"1918.3" / "1600-1900"）没有单位，也接受。
  const isBareNumeric = /^[\d.,]+([-~–][\d.,]+)?$/.test(text);
  if (!hasUnit && !isBareNumeric) return null;
  // 取第一个落在合理区间的数字作为代表海拔：
  // "约2900米" → 2900，"4506-4680米" → 4506，"海拔3100米（相对高差1000米）" → 3100。
  for (const raw of text.match(/\d+(?:[.,]\d+)?/g) || []) {
    const n = Number(raw.replace(",", "."));
    if (Number.isFinite(n) && n >= 0 && n <= 9000) return n;
  }
  return null;
}

// 两个地点的高差。elevation 是 AI 生成的自由文本，异常值必须整段作废而不是拿来用：
// 实测 "4506-4680米" 曾被上一版正则解析成 -4680，与 2900 米相减得到荒谬的 7580m，
// 把 5.2km 的索道段误判成公路下撤。
export function elevationDeltaM(fromElevation: unknown, toElevation: unknown): number | null {
  const a = parseElevationM(fromElevation);
  const b = parseElevationM(toElevation);
  if (a == null || b == null) return null;
  const delta = Math.round(b - a);
  return Math.abs(delta) > MAX_ELEVATION_DELTA_M ? null : delta;
}

export const SCENIC_SHUTTLE_HARD_MAX_M = 12000;
export const ASCENT_TRANSFER_M = 300;       // 超过即不可视为普通徒步段
export const ROAD_TRANSFER_M = 800;         // 大落差 + 较远距离 = 必须公路/索道下撤
export const ASCENT_MIN_PER_100M = 6;       // Naismith 修正：爬升额外耗时

// 结合直线距离与高差，返回"至少要用什么交通方式"。
// 高差只在平面距离已超出可步行范围时参与判定：2km 内爬 800m 是正常徒步段，
// 7km 降 1386m（泰山日观峰→岱庙）则是公路下撤，不能按平面距离算。
export function minModeForTransfer(
  distanceM: number | null | undefined,
  elevationDeltaM: number | null = null,
): RouteEdge["mode"] {
  let mode = inferTransferMode(distanceM);
  // 大落差只升级到 shuttle，不升级到 car：
  // 冰川公园栈道→蓝月谷直线 5.2km、高差 1606m，真实方式是索道+景区观光车，
  // 山上根本没有可供"专车/包车"行驶的公路。落差的含义是"不可当作平面徒步段"，
  // 不是"距离远"。距离维度仍由 inferTransferMode 决定 car。
  if (distanceM != null && elevationDeltaM != null && distanceM > WALK_MAX_M) {
    const drop = Math.abs(elevationDeltaM);
    if (drop >= ASCENT_TRANSFER_M) mode = rankMode(mode, "shuttle");
  }
  return mode;
}

// 资料显式边的"物理不可能"下限。与 minModeForTransfer 不同，这里只取明显越界的量，
// 目的是拦住 auto-research 把跨片区位移写成步行，而不是推翻一切交通资料
// （景区摆渡车跑 28km/30 分钟是真实存在的，不能按 12km 上限武断改写）。
export const PHYSICAL_WALK_MAX_M = 8000;
export const PHYSICAL_ASCENT_DROP_M = 800;

export function walkViolationMinMode(
  distanceM: number | null | undefined,
  elevationDeltaM: number | null = null,
): RouteEdge["mode"] {
  if (distanceM == null) return "walk";
  if (distanceM > SCENIC_SHUTTLE_MAX_M) return "car";
  if (distanceM > PHYSICAL_WALK_MAX_M) return "shuttle";
  if (distanceM > WALK_MAX_M && elevationDeltaM != null && Math.abs(elevationDeltaM) >= PHYSICAL_ASCENT_DROP_M) return "shuttle";
  return "walk";
}

// buildRouteGraph 会为 trail 相邻站生成默认 walk 边（source: "trail:<id>"）。
// 那类边只代表"资料没说别的交通方式"，不是"资料主张这是步行"，
// 因此可以也必须被距离/高差下限推翻；而人工或研究显式给出的边保持权威。
export function isSyntheticWalkEdge(edge?: RouteEdge): boolean {
  return !edge || String(edge.source || "").startsWith("trail:");
}

// 直线里程 → 山路实际里程与车程分钟数。用于给出可核查的耗时，而不是"需接驳"。
export function estimateRoadTransfer(distanceM: number, mode: RouteEdge["mode"]) {
  const detour = ROAD_DETOUR_FACTOR[mode] ?? ROAD_DETOUR_FACTOR.other;
  const roadKm = (distanceM / 1000) * detour;
  const minutes = mode === "car"
    ? Math.round((roadKm / MOUNTAIN_ROAD_KMH) * 60)
    : Math.round((roadKm / 35) * 60);
  return { roadKm: Math.round(roadKm * 10) / 10, minutes };
}

// 跨片区车行必须对 AI 显式禁话，否则模型会把长距离位移复述成观光车短驳。
const MODE_DIRECTIVE: Partial<Record<RouteEdge["mode"], string>> = {
  car: "narrative 必须写明需乘车/包车并给出时长，禁止描述为景区观光车短驳或索道直达",
  shuttle: "narrative 须写明乘坐景区观光车或摆渡车",
};

function ensureNode(graph: RouteGraph, name: string, stop?: { lat?: number; lng?: number; aliases?: string[] }) {
  const key = normalizeName(name);
  if (!key) return "";
  let node = graph.nodes.get(key);
  if (!node) {
    node = { key, name: String(name).trim(), aliases: [], trailIds: new Set(), zoneIds: new Set() };
    graph.nodes.set(key, node);
  }
  if (!node.lat && stop?.lat) node.lat = stop.lat;
  if (!node.lng && stop?.lng) node.lng = stop.lng;
  for (const alias of [...(stop?.aliases || []), ...implicitNodeAliases(node.name)]) {
    const value = String(alias).trim();
    if (value && !node.aliases.includes(value)) node.aliases.push(value);
  }
  return key;
}

function addEdge(graph: RouteGraph, from: string, to: string, edge: RouteEdge, force = false) {
  if (!from || !to || from === to) return;
  const key = `${from}|${to}`;
  if (force || !graph.edges.has(key)) graph.edges.set(key, edge);
  // 山地资料里的步道经常只写单向后检索时需要反查；真实方向由 trail 顺序保留。
  const reverseKey = `${to}|${from}`;
  const reverseEdge = { ...edge, from: edge.to, to: edge.from };
  // 显式索道/观光车边必须同时覆盖正向和反向，否则“索道上站→下站”的
  // 反向边会残留 trail 的默认 walk，最后生成“缆车上、徒步下”的错误叙述。
  if (force || !graph.edges.has(reverseKey)) {
    graph.edges.set(reverseKey, reverseEdge);
  }
}

// 把 trails 顺序和显式 edges 合成一张可校验的图。trails 连续站点会生成默认徒步边；
// 显式 edges 可覆盖为索道、观光车、专车等真实交通方式。
export function buildRouteGraph(knowledge: DestinationRouteKnowledge): RouteGraph {
  const graph: RouteGraph = { nodes: new Map(), edges: new Map() };
  knowledge.trails.forEach((trail, trailIndex) => {
    const trailId = trail.id || `trail-${trailIndex + 1}`;
    const zoneIds = new Set([trail.zoneId, trail.scenicName].filter(Boolean) as string[]);
    const keys = trail.stops.map(stop => {
      const key = ensureNode(graph, stop.name, stop);
      const node = graph.nodes.get(key);
      if (node) {
        node.trailIds.add(trailId);
        for (const zone of zoneIds) node.zoneIds.add(zone);
        // “蓝月谷导览驿站”这类站点不能只匹配完整站名；同一景区内的实际 POI
        // 常叫“蓝月谷”。把短景区名作为节点别名，但游客中心这类跨区设施不扩大别名。
        // v90：设施节点不得用景区名当派生别名。
        // 实测玉龙雪山 auto-research 知识里，节点「蓝月谷游览车-候车厅」因含景区名
        // "蓝月谷" 被派生出该别名，于是地点"玉龙雪山国家级风景名胜区蓝月谷"绑到了一座
        // 候车厅上，整段蓝月谷的步道顺序由一个设施点决定；而真正的索道交通边
        // （游客服务中心→索道候车厅→冰川公园）反而一条都没绑上。
        // 资料里显式声明的 aliases 不受此限制（那是人工/研究明确主张的等价名）。
        if (trail.scenicName && node.name.includes(trail.scenicName)
          && node.name !== trail.scenicName && !isNonSitePOI(node.name)) {
          node.aliases.push(trail.scenicName);
        }
      }
      return key;
    });
    for (let i = 0; i < keys.length - 1; i++) {
      const fromNode = graph.nodes.get(keys[i]);
      const toNode = graph.nodes.get(keys[i + 1]);
      if (!fromNode || !toNode) continue;
      addEdge(graph, keys[i], keys[i + 1], {
        from: fromNode.name,
        to: toNode.name,
        mode: "walk",
        source: `trail:${trailId}`,
        confidence: knowledge.confidence,
      });
    }
  });

  for (const edge of knowledge.edges) {
    const from = ensureNode(graph, edge.from);
    const to = ensureNode(graph, edge.to);
    // trails 先生成默认 walk 边；这里必须强制覆盖，否则显式索道/观光车/专车
    // 会在同向同名边上被默认徒步边挡住。
    addEdge(graph, from, to, edge, true);
  }
  return graph;
}

function scoreNode(locName: string, node: GraphNode, loc: { lat?: number; lng?: number }) {
  const target = normalizeName(locName);
  if (!target) return null;
  let nameScore: number | null = null;
  for (const alias of [node.name, ...node.aliases]) {
    const candidate = normalizeName(alias);
    if (!candidate) continue;
    if (target === candidate) nameScore = Math.max(nameScore ?? -1, 3);
    else if (target.endsWith(candidate)) nameScore = Math.max(nameScore ?? -1, 2);
    else if (target.includes(candidate)) nameScore = Math.max(nameScore ?? -1, 1);
    else {
      // 剥离设施后缀才相等：算命中但只给 1.5 分，
      // 低于精确(3)与后缀(2)，这样同一景区下若存在真实景点节点，
      // 绝不会由"候车厅/服务中心"这类设施节点来抢占位置。
      const stripped = stripFacilitySuffix(alias);
      if (stripped && (target === stripped || target.endsWith(stripped))) {
        nameScore = Math.max(nameScore ?? -1, 1.5);
      }
    }
  }
  if (nameScore == null) return null;
  const distance = node.lat && node.lng && loc.lat && loc.lng
    ? haversineM({ lat: node.lat, lng: node.lng }, loc as any)
    : null;
  // 同名异地必须由坐标否决，例如“翠屏山-三清殿”和恒山山脚三清殿。
  if (distance != null && distance > 10000) return null;
  return { score: nameScore - (distance == null ? 0 : distance / 100000) };
}

export function matchLocsToGraph(stopIds: string[], locs: any[], graph: RouteGraph) {
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const matches = new Map<string, GraphNode>();
  const candidates: { id: string; node: GraphNode; score: number }[] = [];
  for (const id of stopIds) {
    const loc = byId.get(id);
    if (!loc) continue;
    for (const node of graph.nodes.values()) {
      const score = scoreNode(String(loc.name || ""), node, loc);
      if (score) candidates.push({ id, node, score: score.score });
    }
  }
  // “入口”和“入口服务点”可能都能匹配同一个图节点。若允许一对多，
  // 辅助设施会抢走真实入口的位置，步道顺序就会被倒置。
  const usedIds = new Set<string>();
  const usedNodeKeys = new Set<string>();
  candidates
    .sort((a, b) => b.score - a.score || stopIds.indexOf(a.id) - stopIds.indexOf(b.id))
    .forEach(candidate => {
      if (usedIds.has(candidate.id) || usedNodeKeys.has(candidate.node.key)) return;
      usedIds.add(candidate.id);
      usedNodeKeys.add(candidate.node.key);
      matches.set(candidate.id, candidate.node);
    });
  return matches;
}

function primaryZone(node: GraphNode) {
  return node.zoneIds.size ? [...node.zoneIds][0] : "";
}

// 研究资料里“原路返回”的索道线（例如冰川公园）表示山顶点必须索道往返。
// 若下一段去往其他分区，不能因缺少直达边就回退为徒步。
function roundTripTransfer(
  graph: RouteGraph,
  knowledge: DestinationRouteKnowledge,
  fromKey: string,
  toKey: string,
) {
  for (const trail of knowledge.trails) {
    if (!trail.notes || !trail.stops.length || !/原路返回/.test(trail.notes)) continue;
    const terminal = trail.stops.at(-1)!;
    const terminalKey = normalizeName(terminal.name);
    if (terminalKey !== fromKey) continue;
    const previous = trail.stops.at(-2);
    if (!previous) continue;
    const inboundEdge = graph.edges.get(`${terminalKey}|${normalizeName(previous.name)}`);
    if (inboundEdge?.mode !== "cableway") continue;
    const directEdge = graph.edges.get(`${fromKey}|${toKey}`);
    if (directEdge && directEdge.mode !== "walk") continue;
    return `先乘索道下至${previous.name}，再换乘观光车/接驳前往目的地`;
  }
  return null;
}

function directZoneForLoc(loc: { name?: string }, zones: DestinationRouteKnowledge["zones"]) {
  const locName = normalizeName(loc.name);
  for (const zone of zones) {
    for (const keyword of [zone.name, ...(zone.aliases || [])]) {
      const value = normalizeName(keyword);
      if (value && locName.includes(value)) return zone.id;
    }
  }
  return "";
}

function zoneMapForStops(stopIds: string[], byId: Map<string, any>, knowledge: DestinationRouteKnowledge) {
  const zoneByLocId = new Map<string, string>();
  const directZoneByLocId = new Map<string, string>();
  for (const id of stopIds) {
    const loc = byId.get(id);
    if (!loc) continue;
    const zoneId = directZoneForLoc(loc, knowledge.zones);
    if (zoneId) {
      zoneByLocId.set(id, zoneId);
      directZoneByLocId.set(id, zoneId);
    }
  }
  for (const id of stopIds) {
    if (zoneByLocId.has(id)) continue;
    const loc = byId.get(id);
    if (!loc?.lat || !loc.lng) continue;
    let best: { zoneId: string; distance: number } | null = null;
    for (const [anchorId, zoneId] of directZoneByLocId) {
      const anchor = byId.get(anchorId);
      if (!anchor?.lat || !anchor.lng) continue;
      const distance = haversineM(anchor, loc);
      if (distance <= 6000 && (!best || distance < best.distance)) best = { zoneId, distance };
    }
    if (best) zoneByLocId.set(id, best.zoneId);
  }
  return zoneByLocId;
}

// 已知步道只覆盖其中一部分站点时，不能把其余同区点按“重要性顺序”堆在末尾；
// 那会再造出山顶→山脚→半山这类锯齿。按最小绕行增量把它们插回步道骨架。
function integrateUnmatchedStops(
  ordered: string[],
  unmatched: string[],
  byId: Map<string, any>,
) {
  if (!ordered.length || !unmatched.length) return [...ordered, ...unmatched];
  const path = [...ordered];
  for (const id of unmatched) {
    const point = byId.get(id);
    if (!point?.lat || !point.lng) {
      path.push(id);
      continue;
    }
    let bestIndex = path.length;
    let bestCost = Infinity;
    // 不插到已知步道起点之前：auto-research 的游客中心/入口常会缺坐标，
    // 若按直线距离把半山点插到入口前，会把整条步道方向倒置。
    for (let index = 1; index <= path.length; index++) {
      const previous = index > 0 ? byId.get(path[index - 1]) : null;
      const next = index < path.length ? byId.get(path[index]) : null;
      let cost: number;
      if (index === 0) {
        cost = next?.lat && next.lng ? haversineM(point, next) : 0;
      } else if (index === path.length) {
        cost = previous?.lat && previous.lng ? haversineM(previous, point) : 0;
      } else if (previous?.lat && previous.lng && next?.lat && next.lng) {
        cost = haversineM(previous, point) + haversineM(point, next) - haversineM(previous, next);
      } else {
        continue;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    }
    // 超过本地绕行容忍度的点属于接驳/延伸段，保持在整个步道骨架之后。
    path.splice(bestCost <= 8000 ? bestIndex : path.length, 0, id);
  }
  return path;
}
function trailOrderForZone(zoneId: string, ids: Set<string>, matches: Map<string, GraphNode>, knowledge: DestinationRouteKnowledge) {
  const ordered: string[] = [];
  for (const trail of knowledge.trails) {
    const trailZone = trail.zoneId || trail.scenicName || "";
    if (zoneId && trailZone !== zoneId) continue;
    for (const stop of trail.stops) {
      const key = normalizeName(stop.name);
      const hit = [...ids].find(id => matches.get(id)?.key === key);
      if (hit && !ordered.includes(hit)) ordered.push(hit);
    }
  }
  return ordered;
}

// 路线图规划第一层：把站点分成完整的徒步区段，而不是把 A 区、B 区站点按重要性混排。
// 每段内部用 trail 顺序；未匹配点先归入 5km 内最近区段，真正的远点保留在最后，
// 交给显式 edges 或长距离接驳处理。
export function routeGraphSegments(stopIds: string[], locs: any[], knowledge: DestinationRouteKnowledge): RouteGraphSegment[] {
  if (!stopIds.length || !knowledge.trails.length) return [];
  const graph = buildRouteGraph(knowledge);
  const matches = matchLocsToGraph(stopIds, locs, graph);
  if (![...matches.keys()].some(id => stopIds.includes(id))) return [];
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const groupMap = new Map<string, RouteGraphSegment>();
  const groupOrder: string[] = [];
  const assigned = new Set<string>();

  const ensureGroup = (zoneId: string) => {
    if (!groupMap.has(zoneId)) {
      groupMap.set(zoneId, { zoneId, zoneName: zoneId, trailIds: [], stopIds: [] });
      groupOrder.push(zoneId);
    }
    return groupMap.get(zoneId)!;
  };

  for (const trail of knowledge.trails) {
    const zoneId = trail.zoneId || trail.scenicName || "";
    const group = ensureGroup(zoneId);
    const trailId = trail.id || `trail-${knowledge.trails.indexOf(trail) + 1}`;
    if (!group.trailIds.includes(trailId)) group.trailIds.push(trailId);
    for (const stop of trail.stops) {
      const key = normalizeName(stop.name);
      const hit = stopIds.find(id => matches.get(id)?.key === key);
      if (hit && !assigned.has(hit)) {
        group.stopIds.push(hit);
        assigned.add(hit);
      }
    }
  }

  for (const id of stopIds) {
    if (assigned.has(id)) continue;
    const loc = byId.get(id);
    let nearest: { zoneId: string; distance: number } | null = null;
    for (const group of groupMap.values()) {
      for (const anchorId of group.stopIds) {
        const anchor = byId.get(anchorId);
        if (!loc?.lat || !loc.lng || !anchor?.lat || !anchor.lng) continue;
        const distance = haversineM(loc, anchor);
        if (distance <= 5000 && (!nearest || distance < nearest.distance)) nearest = { zoneId: group.zoneId, distance };
      }
    }
    if (nearest) ensureGroup(nearest.zoneId).stopIds.push(id);
    if (nearest) assigned.add(id);
  }

  const segments = groupOrder.map(zoneId => groupMap.get(zoneId)!).filter(group => group.stopIds.length);
  const leftovers = stopIds.filter(id => !assigned.has(id));
  if (leftovers.length) {
    segments.push({ zoneId: "", zoneName: "未分区", trailIds: [], stopIds: leftovers });
  }
  for (const segment of segments) {
    const idSet = new Set(segment.stopIds);
    const trailOrdered = trailOrderForZone(segment.zoneId, idSet, matches, knowledge);
    if (!trailOrdered.length) continue;
    segment.stopIds = integrateUnmatchedStops(
      trailOrdered,
      segment.stopIds.filter(id => !trailOrdered.includes(id)),
      byId,
    );
  }
  return segments;
}

export function planGraphStops(stopIds: string[], locs: any[], knowledge: DestinationRouteKnowledge): string[] {
  const segments = routeGraphSegments(stopIds, locs, knowledge);
  return segments.flatMap(segment => segment.stopIds);
}

export function routeGraphIssues(
  stopIds: string[],
  locs: any[],
  knowledge: DestinationRouteKnowledge,
  options: RouteGraphOptions = {},
): RouteGraphIssue[] {
  if (stopIds.length < 2) return [];
  // 注意：这里不能因为 knowledge.trails 为空就整体短路返回。
  // 原实现在目的地没有路线知识时跳过全部校验，而"新目的地"恰恰必然没有知识——
  // 实测 12 个线上导览有 10 个走的是这条短路，等于新导览完全不过体检。
  // 步道顺序/跨区交错两项依赖知识，空 trails 时自然不产出；
  // 交通衔接与每日容量是纯物理量校验，必须始终执行。
  const graph = buildRouteGraph(knowledge);
  const matches = matchLocsToGraph(stopIds, locs, graph);
  const issues: RouteGraphIssue[] = [];
  const longTransferM = options.longTransferM ?? 8000;

  // 1. 同一条已知步道的匹配点必须按资料顺序推进，禁止 A→C→B。
  for (const trail of knowledge.trails) {
    const indexes = new Map(trail.stops.map((stop, index) => [normalizeName(stop.name), index]));
    const positions = stopIds
      .map(id => matches.get(id)?.key)
      .filter((key): key is string => !!key && indexes.has(key))
      .map(key => indexes.get(key)!);
    // 整体反向（严格递减）是合法的下撤方向，不是回退：同一批站点既可能上山走也可能下山走。
    // 只有既非递增也非递减的序列才是真正的折返乱序（恒山 1日线实测：
    // 下山到山脚三清殿后又折回半山三元宫，属真乱序，必须保留告警）。
    const monotonicInc = positions.every((pos, i) => i === 0 || pos >= positions[i - 1]);
    const monotonicDec = positions.every((pos, i) => i === 0 || pos <= positions[i - 1]);
    if (positions.length >= 2 && !monotonicInc && !monotonicDec) {
      issues.push({
        type: "trail-backtrack",
        level: "blocking",
        message: `步道「${trail.scenicName || trail.id || "未命名"}」出现顺序回退`,
      });
    }
  }

  // 2. 多个徒步区必须整段串联，不能 A 区→B 区→A 区乱跳。
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const zones = stopIds.map(id => {
    const node = matches.get(id);
    if (node) return primaryZone(node);
    const loc = byId.get(id);
    if (!loc?.lat || !loc.lng) return "";
    let nearest: { zone: string; distance: number } | null = null;
    for (const [otherId, other] of matches) {
      const otherLoc = byId.get(otherId);
      if (!otherLoc?.lat || !otherLoc.lng) continue;
      const zone = primaryZone(other);
      const distance = haversineM(loc, otherLoc);
      if (zone && distance <= 5000 && (!nearest || distance < nearest.distance)) nearest = { zone, distance };
    }
    return nearest?.zone || "";
  }).filter(Boolean);
  const firstSeen = new Map<string, number>();
  zones.forEach((zone, index) => {
    if (!firstSeen.has(zone)) {
      firstSeen.set(zone, index);
      return;
    }
    const previous = index > 0 ? zones[index - 1] : "";
    if (previous !== zone && firstSeen.get(zone)! < index - 0) {
      issues.push({
        type: "zone-interleaved",
        level: "blocking",
        message: `「${zone}」被其他徒步区隔断，存在跨区往返`,
      });
    }
  });

  // 3. 长距离相邻点必须有正确标注的交通衔接。
  // P1-3: 主题游不再整体豁免长距离检查。原实现把 allowLongTransfers 当成
  // "跳过全部距离校验"，导致丽江主题游里 拉市海→香格里拉虎跳峡（直线 36.7km，
  // 实际约 2.3 小时车程，跨地级市）被静默放行并写成"乘景区观光车直线约 37 公里"。
  // 新语义：主题游允许长距离串联，但长距离段必须被标成对应的机动方式，
  // 超过景区摆渡合理上限（SCENIC_SHUTTLE_MAX_M）就必须是 car。
  const legs = buildRouteLegs(stopIds, locs, knowledge);
  for (const leg of legs) {
    const distance = leg.distanceM ?? null;
    const drop = leg.elevationDeltaM != null ? Math.abs(leg.elevationDeltaM) : null;
    const far = distance != null && distance > longTransferM;
    // 大落差段独立于平面距离闸门：泰山日观峰→岱庙直线只有 7.12km（< 8km 阈值），
    // 但 1386m 落差使它在物理上不可能是平面短驳，旧实现因此永久漏报。
    const bigDropNeedsTransport =
      drop != null && drop >= ASCENT_TRANSFER_M
      && (distance ?? 0) > WALK_MAX_M && leg.mode !== "cableway";

    if (leg.edgeMode && leg.mode !== leg.edgeMode) {
      // 资料显式给出方式，但被物理量纠正 → 错的是目的地知识本身，
      // 对所有路线类型上报（含主题游），因为不修它下次生成还会复现。
      const why = [distance && distance > longTransferM ? `直线约 ${Math.round(distance / 1000)}km` : "", drop != null && drop >= ASCENT_TRANSFER_M ? `高差约 ${drop}m` : ""]
        .filter(Boolean).join("、") || "直线与高差不支持该方式";
      const claimed = leg.edgeSynthetic ? "步道顺序默认按步行处理（资料未给交通方式）" : `资料标注为「${MODE_TEXT[leg.edgeMode]}」`;
      issues.push({
        type: "long-transfer",
        level: "advisory",
        message: `${leg.fromName} → ${leg.toName} ${claimed}，但${why}，实际需改用「${MODE_TEXT[leg.mode]}」`,
      });
    } else if (leg.inferred && ((far && !options.allowLongTransfers) || bigDropNeedsTransport)) {
      const why = [distance != null ? `直线约 ${Math.round(distance / 1000)}km` : "", drop != null ? `高差约 ${drop}m` : ""]
        .filter(Boolean).join("、");
      issues.push({
        type: "long-transfer",
        level: (distance ?? 0) > HARD_TRANSFER_M && !options.allowLongTransfers ? "blocking" : "advisory",
        message: `${leg.fromName} → ${leg.toName}（${why}）资料中无衔接方式，已推断为「${MODE_TEXT[leg.mode]}」（未经核实）`,
      });
    }
    // 跨市/跨景区级别的位移（>30km）必须带车程估算，否则 narrative 无法写清可达性。
    if ((distance ?? 0) > 30000 && leg.roadMinutes == null) {
      issues.push({
        type: "long-transfer",
        level: "blocking",
        message: `${leg.fromName} → ${leg.toName} 直线超过 30km 但无车程估算，行程可行性无法校验`,
      });
    }
  }

  // 4. 每日容量：2日全景游整条 stops 无法在数据库里拆出“第1/2天”，
  // 所以先按标签日数放大阈值；只要总耗时除以天数后仍超限就告警。
  const duration = estimateRouteDuration(legs, stopIds.length);
  const dayMatch = String(options.dayLabel || "").match(/(\d+)\s*日/);
  const days = Math.max(1, options.dayCount ?? (dayMatch ? Number(dayMatch[1]) : 1));
  const dailyHours = options.maxDailyHours ?? 10;
  if (duration.totalMinutes > days * dailyHours * 60) {
    issues.push({
      type: "long-day",
      level: "blocking",
      message: `预计全程 ${Math.round(duration.totalMinutes / 60 * 10) / 10} 小时（移动 ${Math.round(duration.movementMinutes / 60 * 10) / 10}h + 停留 ${Math.round(duration.visitMinutes / 60 * 10) / 10}h），超过 ${days} 日 × ${dailyHours} 小时容量`,
    });
  }

  const seen = new Set<string>();
  return issues.filter(issue => {
    const key = `${issue.type}|${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 给 AI 的 narrative 提供交通衔接约束。站点集合/顺序仍由代码确定，AI 只能描述这些衔接。
export function routeGraphNotes(stopIds: string[], locs: any[], knowledge: DestinationRouteKnowledge) {
  if (stopIds.length < 2) return "";
  const graph = buildRouteGraph(knowledge);
  const matches = matchLocsToGraph(stopIds, locs, graph);
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const notes: string[] = [];
  for (let i = 0; i < stopIds.length - 1; i++) {
    const a = byId.get(stopIds[i]);
    const b = byId.get(stopIds[i + 1]);
    if (!a || !b) continue;
    const aKey = matches.get(a.id)?.key;
    const bKey = matches.get(b.id)?.key;
    const edge = aKey && bKey ? graph.edges.get(`${aKey}|${bKey}`) : undefined;
    const distance = a.lat && a.lng && b.lat && b.lng ? haversineM(a, b) : null;
    if (edge) {
      const detail = [MODE_TEXT[edge.mode] || MODE_TEXT.other, edge.duration, edge.note].filter(Boolean).join("，");
      notes.push(`${a.name} → ${b.name}：${detail}`);
      continue;
    }
    if (distance != null && distance > 8000) {
      notes.push(`${a.name} → ${b.name}：长距离换乘，用观光车/摆渡车/专车，不写成徒步`);
    }
  }
  return [...new Set(notes)].join("；");
}

// 把站点序列拆成交通 leg。显式 edge 优先；同一条 trail 的相邻点默认徒步；
// 缺资料但距离很远时用保守的接驳描述，不把长距离位移交给 AI 自由想象。
// 内部使用别名，避免与局部变量同名造成遮蔽。
const elevationDeltaMOf = elevationDeltaM;

export function buildRouteLegs(stopIds: string[], locs: any[], knowledge: DestinationRouteKnowledge): RouteLeg[] {
  if (stopIds.length < 2) return [];
  const graph = buildRouteGraph(knowledge);
  const matches = matchLocsToGraph(stopIds, locs, graph);
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const zoneByLocId = zoneMapForStops(stopIds, byId, knowledge);
  const legs: RouteLeg[] = [];
  for (let i = 0; i < stopIds.length - 1; i++) {
    const from = byId.get(stopIds[i]);
    const to = byId.get(stopIds[i + 1]);
    if (!from || !to) continue;
    const fromKey = matches.get(from.id)?.key;
    const toKey = matches.get(to.id)?.key;
    const edge = fromKey && toKey ? graph.edges.get(`${fromKey}|${toKey}`) : undefined;
    const distanceM = from.lat && from.lng && to.lat && to.lng ? Math.round(haversineM(from, to)) : undefined;
    const transfer = fromKey ? roundTripTransfer(graph, knowledge, fromKey, toKey || "") : null;
    let mode: RouteEdge["mode"] = "walk";
    let note: string | undefined = transfer || undefined;
    // 跨徒步/索道分区是"必须机动化"的信号，与距离分层取更严格的一方。
    const crossZone =
      (fromKey && toKey && primaryZone(graph.nodes.get(fromKey)!) !== primaryZone(graph.nodes.get(toKey)!))
      || !!(zoneByLocId.get(from.id) && zoneByLocId.get(to.id) && zoneByLocId.get(from.id) !== zoneByLocId.get(to.id));
    const elevationDeltaM = elevationDeltaMOf(from.elevation, to.elevation) ?? undefined;
    const floor = minModeForTransfer(distanceM, elevationDeltaM ?? null);
    if (transfer) {
      mode = "cableway";
    } else if (edge && !isSyntheticWalkEdge(edge)) {
      // 显式资料边保持权威，仅在"步行段物理上不可能"时纠正
      // （过长或过大落差），避免把真实摆渡资料武断改写。
      mode = edge.mode === "walk"
        ? rankMode("walk", walkViolationMinMode(distanceM, elevationDeltaM ?? null))
        : edge.mode;
      note = edge.note;
    } else if (edge) {
      // trail 默认生成的 walk 边：按距离/高差下限校正
      mode = rankMode(edge.mode, floor);
      note = edge.note;
    } else if (crossZone && distanceM != null && distanceM > SCENIC_SHUTTLE_MAX_M) {
      mode = "car";
      note = `跨片区（直线约 ${Math.round(distanceM / 1000)}km），需乘车/包车`;
    } else if (crossZone) {
      mode = rankMode("shuttle", floor);
      note = "不同徒步/索道分区，需换乘观光车或接驳车";
    } else {
      mode = floor;
    }
    // 推断结果与资料冲突时，把冲突原因写进 note，供审核页与 prompt 使用。
    if (edge && mode !== edge.mode) {
      const km = Math.round((distanceM || 0) / 1000);
      const drop = elevationDeltaM != null ? `、高差约 ${Math.abs(elevationDeltaM)}m` : "";
      const reason = isSyntheticWalkEdge(edge) ? "步道顺序未给交通方式" : `资料标注为${MODE_TEXT[edge.mode]}`;
      note = note
        ? `${note}（${reason}，但直线约 ${km}km${drop}，需改用${MODE_TEXT[mode]}）`
        : `${reason}，但直线约 ${km}km${drop}，需改用${MODE_TEXT[mode]}`;
    }
    // 大落差必须显式写进衔接说明，否则 narrative 会把它写成"沿路步行前往"。
    const dropNote = elevationDeltaM != null && Math.abs(elevationDeltaM) >= ASCENT_TRANSFER_M && mode !== "cableway"
      ? `高差约 ${Math.abs(elevationDeltaM)}m，须借助索道或景区交通${elevationDeltaM < 0 ? "下撤" : "上升"}，禁止写成连续徒步`
      : "";
    if (dropNote) note = note ? `${note}；${dropNote}` : dropNote;
    if (!note) {
      if (distanceM != null && mode === "car") {
        const road = estimateRoadTransfer(distanceM, "car");
        note = `直线约 ${Math.round(distanceM / 1000)}km，山路约 ${road.roadKm}km / ${road.minutes} 分钟车程`;
      } else if (distanceM != null && mode === "shuttle") {
        note = `直线约 ${Math.round(distanceM / 1000)}km，建议乘坐景区观光车`;
      }
    }
    const road = distanceM != null && mode !== "walk" && mode !== "cableway"
      ? estimateRoadTransfer(distanceM, mode)
      : null;
    legs.push({
      fromId: from.id,
      toId: to.id,
      fromName: String(from.name || ""),
      toName: String(to.name || ""),
      mode,
      duration: edge?.duration,
      note,
      distanceM,
      roadKm: road?.roadKm,
      roadMinutes: road?.minutes,
      edgeMode: edge?.mode,
      edgeSynthetic: edge ? isSyntheticWalkEdge(edge) : undefined,
      inferred: (!edge || isSyntheticWalkEdge(edge)) && !transfer,
      elevationDeltaM,
    });
  }
  return legs;
}

export function routeLegsText(legs: RouteLeg[]) {
  return legs.map(leg => {
    const mode = MODE_TEXT[leg.mode] || MODE_TEXT.other;
    // 车程优先用资料 duration；缺资料时用直线换算的保守山路车程，
    // 避免把 37km 的山路写成一句笼统的"需接驳"。
    const eta = leg.duration
      ? leg.duration
      : leg.roadMinutes != null ? `约 ${Math.round(leg.roadMinutes / 6 * 10) / 10} 小时车程` : "";
    const detail = [mode, eta, leg.note].filter(Boolean).join("，");
    const directive = MODE_DIRECTIVE[leg.mode];
    return `${leg.fromName} → ${leg.toName}：${detail}${directive ? `（${directive}）` : ""}`;
  }).join("；");
}

// 粗粒度行程容量校验：优先使用资料中的 duration；缺资料时用交通方式的保守默认速度。
// 停留时间按每站 20 分钟估算，只用于发现“一天塞 20 站”这类明显超载，不假装是精确 ETA。
export function estimateRouteDuration(legs: RouteLeg[], stopCount: number): RouteDurationEstimate {
  let movementMinutes = 0;
  let estimatedLegs = 0;
  for (const leg of legs) {
    const durationText = String(leg.duration || "").trim();
    let minutes: number | null = null;
    const hourMatch = durationText.match(/(\d+(?:\.\d+)?)\s*(?:小时|hr|hour)/i);
    const minuteMatch = durationText.match(/(\d+(?:\.\d+)?)\s*(?:分钟|min|minute)/i);
    if (hourMatch) minutes = Number(hourMatch[1]) * 60;
    if (minuteMatch) minutes = (minutes || 0) + Number(minuteMatch[1]);

    if (minutes == null) {
      estimatedLegs++;
      if (leg.roadMinutes != null) {
        // P1-3: 机动车段优先用直线换算出的山路车程（含绕行系数与山区均速），
        // 旧的 km*1.8 相当于假设直线 55km/h，山地场景严重低估。
        minutes = leg.roadMinutes;
      } else {
        const km = (leg.distanceM || 0) / 1000;
        // 步行按含盘山绕行的 trail 均速 3.3km/h；索道按直线；
        // 机动车段统一走 estimateRoadTransfer（绕行系数 + 山区均速），
        // 避免旧 km*1.8/2.5 隐含的 55km/h 直线均速严重低估山地车程。
        if (leg.mode === "walk") {
          const ascent = leg.elevationDeltaM != null && leg.elevationDeltaM > 0
            ? (leg.elevationDeltaM / 100) * ASCENT_MIN_PER_100M
            : 0;
          minutes = Math.max(5, km * ROAD_DETOUR_FACTOR.walk * 18 + ascent);
        }
        else if (leg.mode === "cableway") minutes = Math.max(8, km * 3 + 8);
        else minutes = Math.max(8, estimateRoadTransfer(leg.distanceM || 0, leg.mode).minutes);
      }
    }
    movementMinutes += Math.max(0, Math.round(minutes));
  }
  const visitMinutes = Math.max(0, stopCount - 1) * 20;
  const totalMinutes = movementMinutes + visitMinutes;
  return {
    movementMinutes,
    visitMinutes,
    totalMinutes,
    estimatedLegs,
  };
}

// ── 路线闸门：确定性修复（P1-2 / v88）──────────────────────────────
// 校验器已经能诊断出长距离缺衔接、步道回退和每日超容量，但结果只写进 warnings，
// 路线照原样入库、status 照原样置 done。闸门必须做两件事：
//   1. 能在不改站点集合的前提下修好的，就确定性地修好（重排）；
//   2. 必须改动站点集合才能达标的，砍站并把原因留给创作者确认。
//
// 关键位置：本函数在**调用 AI 生成 narrative 之前**执行。
// 如果放在写库前砍站，narrative 里"全程依次经过 X、Y、Z"会与站点数组不一致，
// 那类文本缺陷比路线缺陷更难发现，也会污染详情页。

export type PlanRepair = {
  type: "reordered" | "trimmed";
  message: string;
};

export type PlanRepairResult = {
  stopIds: string[];
  repairs: PlanRepair[];
  issues: RouteGraphIssue[];
  trimmedIds: string[];
};

export function blockingIssues(issues: RouteGraphIssue[]): RouteGraphIssue[] {
  return issues.filter(i => (i.level ?? "advisory") === "blocking");
}

export function advisoryIssues(issues: RouteGraphIssue[]): RouteGraphIssue[] {
  return issues.filter(i => (i.level ?? "advisory") !== "blocking");
}

// 可移除性评分：重要性低、不在步道路径上、位于序列后半段的点先被砍。
// 入口段（前一半）和能在路线图上匹配到节点的点受保护，
// 因为砍掉入口会让整条动线从半山开始，砍掉步道点会打断已验证的连贯性。
function trimmability(loc: any, matched: boolean, index: number, total: number): number {
  return (loc.importance || 3)
    + (matched ? 8 : 0)
    + (index < total / 2 ? 3 : 0);
}

/**
 * 在给定站点集合上做确定性修复，返回修复后的站点、修复动作和剩余问题。
 * 只重排或砍站，绝不新增站点，因此不会引入原计划里不存在的地点。
 */
export function repairPlanStops(
  stopIds: string[],
  locs: any[],
  knowledge: DestinationRouteKnowledge,
  options: RouteGraphOptions = {},
): PlanRepairResult {
  const repairs: PlanRepair[] = [];
  const trimmedIds: string[] = [];
  if (stopIds.length < 2) {
    return { stopIds, repairs, issues: [], trimmedIds };
  }
  let current = [...stopIds];
  const byId = new Map(locs.map(l => [l.id, l]));

  for (let pass = 0; pass < 6; pass++) {
    const issues = routeGraphIssues(current, locs, knowledge, options);
    const blocking = blockingIssues(issues);
    if (!blocking.length) return { stopIds: current, repairs, issues, trimmedIds };

    const backtrack = blocking.find(i => i.type === "trail-backtrack" || i.type === "zone-interleaved");
    if (backtrack) {
      // 站点集合不变，只按路线图整段重排；能修好就不必砍站。
      const reordered = planGraphStops(current, locs, knowledge);
      if (reordered.length === current.length && reordered.join("|") !== current.join("|")) {
        const after = blockingIssues(routeGraphIssues(reordered, locs, knowledge, options));
        if (after.length < blocking.length) {
          current = reordered;
          repairs.push({ type: "reordered", message: `按路线图重排站点顺序，消除「${backtrack.message}」` });
          continue;
        }
      }
    }

    const overCapacity = blocking.find(i => i.type === "long-day");
    // 只剩 advisory（例如单纯缺资料）时不反复砍站：资料问题要靠核实解决，不靠删景点。
    if (overCapacity && current.length > 3) {
      const graph = buildRouteGraph(knowledge);
      const matched = matchLocsToGraph(current, locs, graph);
      let worstIndex = -1;
      let worstScore = Infinity;
      current.forEach((id, index) => {
        const loc = byId.get(id);
        if (!loc) return;
        const score = trimmability(loc, matched.has(id), index, current.length);
        if (score < worstScore) { worstScore = score; worstIndex = index; };
      });
      if (worstIndex >= 0) {
        const [removed] = current.splice(worstIndex, 1);
        const name = String(byId.get(removed)?.name || removed);
        trimmedIds.push(removed);
        repairs.push({ type: "trimmed", message: `超出每日容量，移除低重要性站点「${name}」（行程文案已按剩余站点生成，请确认是否需要保留该点）` });
        continue;
      }
    }

    // 无法用重排或砍站解决：交给创作者判断。
    return { stopIds: current, repairs, issues, trimmedIds };
  }
  return { stopIds: current, repairs, issues: routeGraphIssues(current, locs, knowledge, options), trimmedIds };
}
