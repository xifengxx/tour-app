import { haversineM } from "./geo.ts";
import type { DestinationRouteKnowledge, RouteEdge } from "./route-knowledge-types.ts";

const normalizeName = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[，。、·—\-_\s（）()《》"]/g, "");

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
  type: "zone-interleaved" | "trail-backtrack" | "long-transfer";
  message: string;
};

export type RouteGraphOptions = {
  // 主题游本来就串联核心景区和 60km 内的独立景点；长距离换乘是预期行为。
  allowLongTransfers?: boolean;
  longTransferM?: number;
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
};

const MODE_TEXT: Record<RouteEdge["mode"], string> = {
  walk: "徒步",
  cableway: "索道",
  shuttle: "观光车/摆渡车",
  car: "专车/出租车",
  other: "接驳交通",
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
  for (const alias of stop?.aliases || []) {
    const value = String(alias).trim();
    if (value && !node.aliases.includes(value)) node.aliases.push(value);
  }
  return key;
}

function addEdge(graph: RouteGraph, from: string, to: string, edge: RouteEdge) {
  if (!from || !to || from === to) return;
  const key = `${from}|${to}`;
  if (!graph.edges.has(key)) graph.edges.set(key, edge);
  // 山地资料里的步道经常只写单向后检索时需要反查；真实方向由 trail 顺序保留。
  const reverseKey = `${to}|${from}`;
  if (!graph.edges.has(reverseKey)) {
    graph.edges.set(reverseKey, { ...edge, from: edge.to, to: edge.from });
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
    addEdge(graph, from, to, edge);
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
  for (const id of stopIds) {
    const loc = byId.get(id);
    if (!loc) continue;
    const candidates = [...graph.nodes.values()]
      .map(node => ({ node, score: scoreNode(String(loc.name || ""), node, loc) }))
      .filter((item): item is { node: GraphNode; score: NonNullable<ReturnType<typeof scoreNode>> } => !!item.score)
      .sort((a, b) => b.score.score - a.score.score);
    if (candidates[0]) matches.set(id, candidates[0].node);
  }
  return matches;
}

function primaryZone(node: GraphNode) {
  return node.zoneIds.size ? [...node.zoneIds][0] : "";
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
    if (segments.length) segments[segments.length - 1].stopIds.push(...leftovers);
    else segments.push({ zoneId: "", zoneName: "未分区", trailIds: [], stopIds: leftovers });
  }
  for (const segment of segments) {
    const idSet = new Set(segment.stopIds);
    const trailOrdered = trailOrderForZone(segment.zoneId, idSet, matches, knowledge);
    segment.stopIds = [...trailOrdered, ...segment.stopIds.filter(id => !trailOrdered.includes(id))];
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
  if (stopIds.length < 2 || !knowledge.trails.length) return [];
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
    if (positions.length >= 2 && positions.some((pos, i) => i > 0 && pos < positions[i - 1])) {
      issues.push({
        type: "trail-backtrack",
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
        message: `「${zone}」被其他徒步区隔断，存在跨区往返`,
      });
    }
  });

  // 3. 长距离相邻点必须有非徒步衔接；主题游的长距离串联单独豁免。
  if (!options.allowLongTransfers) {
    for (let i = 0; i < stopIds.length - 1; i++) {
      const a = byId.get(stopIds[i]);
      const b = byId.get(stopIds[i + 1]);
      if (!a?.lat || !a.lng || !b?.lat || !b.lng) continue;
      const distance = haversineM(a, b);
      if (distance <= longTransferM) continue;
      const aKey = matches.get(a.id)?.key;
      const bKey = matches.get(b.id)?.key;
      const edge = aKey && bKey ? graph.edges.get(`${aKey}|${bKey}`) : undefined;
      if (!edge || edge.mode === "walk") {
        issues.push({
          type: "long-transfer",
          message: `${a.name} → ${b.name} 相距约 ${Math.round(distance / 1000)}km，但缺少索道/观光车/专车衔接`,
        });
      }
    }
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
export function buildRouteLegs(stopIds: string[], locs: any[], knowledge: DestinationRouteKnowledge): RouteLeg[] {
  if (stopIds.length < 2) return [];
  const graph = buildRouteGraph(knowledge);
  const matches = matchLocsToGraph(stopIds, locs, graph);
  const byId = new Map(locs.map(loc => [loc.id, loc]));
  const legs: RouteLeg[] = [];
  for (let i = 0; i < stopIds.length - 1; i++) {
    const from = byId.get(stopIds[i]);
    const to = byId.get(stopIds[i + 1]);
    if (!from || !to) continue;
    const fromKey = matches.get(from.id)?.key;
    const toKey = matches.get(to.id)?.key;
    const edge = fromKey && toKey ? graph.edges.get(`${fromKey}|${toKey}`) : undefined;
    const distanceM = from.lat && from.lng && to.lat && to.lng ? Math.round(haversineM(from, to)) : undefined;
    let mode: RouteEdge["mode"] = "walk";
    if (edge) mode = edge.mode;
    else if (distanceM != null && distanceM > 60000) mode = "car";
    else if (distanceM != null && distanceM > 8000) mode = "shuttle";
    legs.push({
      fromId: from.id,
      toId: to.id,
      fromName: String(from.name || ""),
      toName: String(to.name || ""),
      mode,
      duration: edge?.duration,
      note: edge?.note || (distanceM != null && distanceM > 8000 ? `直线约 ${Math.round(distanceM / 1000)}km，需接驳` : undefined),
      distanceM,
    });
  }
  return legs;
}

export function routeLegsText(legs: RouteLeg[]) {
  return legs.map(leg => {
    const mode = MODE_TEXT[leg.mode] || MODE_TEXT.other;
    const detail = [mode, leg.duration, leg.note].filter(Boolean).join("，");
    return `${leg.fromName} → ${leg.toName}：${detail}`;
  }).join("；");
}
