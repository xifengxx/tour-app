// 知识完整度评分（v91）
//
// 旧算法：`confidence = 0.6 + 0.05 × min(证据条数, 3) + 0.02`。
// 它只数"抓回来几段文本"，与内容是否正确无关。实测一次玉龙雪山自动研究，
// 三条证据里有一条是武汉东湖的维基条目（完全无关），照样 +0.05，
// 结论仍然是 0.75 —— 一个看起来像"75% 可信"的数字。
//
// 这里换成可解释的分项评分：每一项都能对应到一条可核查的事实，
// 报告里可以逐项展示，创作者和开发者都能看懂为什么低。
//
// 注意与 knowledge-tier 的分工，两者不能合并成一个数字：
//   tier   回答"来源是否有权威"（人工写的还是机器抽的）→ 决定能力授权
//   quality 回答"这份知识本身完不完整"（坐标、证据、设施噪声、结构）→ 决定可信度与选路排序
// 机器抽取的一行可以坐标很全（quality 高）但依然不该授权多日线（tier L2）。

import { isNonSitePOI, isTransferPOI } from "./poi-filter.ts";
import { buildRouteGraph } from "./route-graph.ts";
import type { DestinationRouteKnowledge, KnowledgeQuality } from "./route-knowledge-types.ts";

/** 来源权威度：人工撰写/确认 > 内置策展 > 机器抽取 > 未知。 */
const SOURCE_TRUST: Record<string, number> = {
  curated: 1, official: 1, manual: 1, "creator-confirmed": 0.92,
  builtin: 0.8, "auto-research": 0.55, research: 0.55, osm: 0.5,
};

const RATIO = (hit: number, total: number) => (total > 0 ? hit / total : 0);
const round = (v: number) => Math.round(v * 100) / 100;

function ratioOf(knowledge: DestinationRouteKnowledge) {
  const trails = knowledge.trails || [];
  const stops = trails.flatMap(t => t.stops || []);
  const total = stops.length;
  const withCoord = stops.filter(s => Number.isFinite(s.lat as number) && Number.isFinite(s.lng as number)).length;
  const evidenceBound = stops.filter(s => s.evidenceBound).length;
  // 噪声只算"既不是景点、也不是登乘点"的条目。
  // 「索道候车厅」「游客服务中心」是真实动线节点（乘索道/接驳车的地方），
  // 作为图的边端点有用，不该扣分；「二级坝旅游厕所」这种才是研究把设施当景点。
  // 注意这与"是否注入成 app 里的景点"是两件事：
  // injectTrailSeeds 只在首站放行入口设施，因为那是给游客看的地点列表。
  const facility = trails.reduce((sum, t) =>
    sum + (t.stops || []).filter(s => isNonSitePOI(s.name) && !isTransferPOI(s.name)).length, 0);
  const stopPairs = trails.reduce((sum, t) => sum + Math.max(0, (t.stops || []).length - 1), 0);
  const structured =
    (trails.length > 0 ? 1 : 0)
    + (trails.some(t => (t.stops || []).length >= 3) ? 1 : 0)
    + (knowledge.zones?.length ? 1 : 0)
    + (trails.some(t => !!t.notes) ? 1 : 0);
  return {
    total, withCoord, evidenceBound, facility, stopPairs,
    coordCoverage: RATIO(withCoord, total),
    evidenceCoverage: RATIO(evidenceBound, total),
    sitePurity: total ? 1 - RATIO(facility, total) : 0,
    structureCompleteness: structured / 4,
  };
}

/**
 * 有多少相邻站点对真的有显式交通边。
 * buildRouteGraph 会为 trail 相邻站生成默认 walk 边（source: "trail:*"），
 * 那只表示"资料没说别的交通方式"，不算覆盖。
 */
export function transportCoverage(knowledge: DestinationRouteKnowledge): number {
  const graph = buildRouteGraph(knowledge);
  let pairs = 0;
  let covered = 0;
  for (const trail of knowledge.trails || []) {
    const stops = trail.stops || [];
    for (let i = 0; i + 1 < stops.length; i++) {
      pairs++;
      const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
      const edge = graph.edges.get(`${norm(stops[i].name)}|${norm(stops[i + 1].name)}`);
      if (edge && !String(edge.source || "").startsWith("trail:")) covered++;
    }
  }
  return RATIO(covered, pairs);
}

export function scoreKnowledge(knowledge: DestinationRouteKnowledge): KnowledgeQuality {
  const r = ratioOf(knowledge);
  const sourceTrust = SOURCE_TRUST[String(knowledge.source || "")] ?? 0.3;
  const parts = {
    sourceTrust,
    coordCoverage: round(r.coordCoverage),
    evidenceCoverage: round(r.evidenceCoverage),
    sitePurity: round(r.sitePurity),
    structureCompleteness: round(r.structureCompleteness),
  };
  const score = round(
    parts.sourceTrust * 0.35
    + parts.coordCoverage * 0.2
    + parts.evidenceCoverage * 0.15
    + parts.sitePurity * 0.15
    + parts.structureCompleteness * 0.15,
  );
  const grade = score >= 0.85 ? "strong" : score >= 0.7 ? "usable" : score >= 0.5 ? "weak" : "unusable";
  return {
    score,
    grade,
    parts,
    transportCoverage: round(transportCoverage(knowledge)),
    stops: r.total,
    trails: (knowledge.trails || []).length,
    edges: (knowledge.edges || []).length,
  };
}

/** 分项缺口的可读说明，直接进 process_report 与审核页。 */
export function qualityGaps(quality: KnowledgeQuality): string[] {
  const gaps: string[] = [];
  if (quality.parts.coordCoverage < 0.8) gaps.push(`${quality.stops - Math.round(quality.parts.coordCoverage * quality.stops)}/${quality.stops} 个站点没有坐标`);
  if (quality.parts.evidenceCoverage < 0.5) gaps.push(`仅 ${Math.round(quality.parts.evidenceCoverage * 100)}% 站点的坐标能追溯到外部证据`);
  if (quality.parts.sitePurity < 0.9) gaps.push("步道里混入了厕所/候车厅等非游览设施点");
  if (quality.transportCoverage < 0.6) gaps.push("相邻站点大多没有显式交通边，索道与观光车关系未记录");
  if (quality.parts.structureCompleteness < 0.75) gaps.push("结构不完整（缺分区、动线说明或站点过少）");
  return gaps;
}
