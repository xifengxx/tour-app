// 路线知识可信度分层（P2 / v89）
//
// 这是终结"每新增一条导览就要迭代一次规划逻辑"的关键一步。
// 在此之前，管线对任何目的地都产出同样的三条路线（1日 / 2日全景 / 主题游），
// 仿佛它已经理解了该目的地的分区与换乘。实际数据是：
//   · 人工策展/创作者确认的目的地：5 个
//   · auto-research 自动抽取、无人核实：新目的地的全部
//   · 完全没有知识：非山岳目的地（research 只在 type=mountain 时触发）
// 三种情况下系统做的事一模一样，所以问题必然随新目的地线性增长。
//
// 分层的含义不是"质量分数"，而是**能力授权**：
// 只有已验证的知识才允许用来决定站点集合与天数划分；
// 未验证时降级产出并如实告知，而不是假装理解。

import type { DestinationRouteKnowledge } from "./route-knowledge-types.ts";

export type KnowledgeTier = "L3" | "L2" | "L1";

export type TierCapabilities = {
  /** 允许多日划分（2日全景游：分区或第二景区装配） */
  multiDay: boolean;
  /** 允许主题游（串联 60km 内独立景点，跨片区接驳） */
  themeTour: boolean;
  /** 允许用知识层的 zones 参与选点（决定 1 日线取哪几个点） */
  zoneDriven: boolean;
  /** 允许用 trails 顺序固定站内顺序 */
  trailOrder: boolean;
  /** 允许把交通方式当成事实写进 narrative（而不是按距离推断） */
  assertTransport: boolean;
};

/** 人工撰写或经人确认过的来源。只有它们能支撑"能力授权"。 */
const VERIFIED_SOURCES = new Set(["curated", "official", "manual", "creator-confirmed", "builtin"]);
/** 机器抽取、无人核实。 */
const RESEARCHED_SOURCES = new Set(["auto-research", "research", "osm"]);

/**
 * `builtin` 是 `trail-routes.ts` 里人工撰写的策展步道快照（泰山/华山/恒山/衡山/嵩山），
 * 与数据库 `curated` 行同源，只是存放在代码里，所以按人工撰写计入 L3。
 * 它不会因为"没进数据库"而被误罚成未核实——但 builtin 本身没有 zones/edges，
 * 下面的 capabilities 与数据形态取与后，zoneDriven 与 assertTransport 仍会自动关闭，
 * 因此 L3-builtin 只解锁"按第二景区划分两天"，不会解锁分区装配与交通断言。
 */
/**
 * 只按来源判定分级，不考虑数据是否已经取到。
 * 供离线工具使用：审计脚本用 anon key 读不到 destination_route_knowledge 的 trails，
 * 但 process_report 里记录了当次实际使用的来源，此时按来源判定才准确。
 */
export function tierForSource(source?: string | null): KnowledgeTier {
  const value = String(source || "");
  if (!value || value === "none") return "L1";
  if (VERIFIED_SOURCES.has(value)) return "L3";
  return "L2";
}

export function knowledgeTier(knowledge?: DestinationRouteKnowledge | null): KnowledgeTier {
  if (!knowledge || !knowledge.trails?.length) return "L1";
  const source = String(knowledge.source || "");
  if (VERIFIED_SOURCES.has(source)) return "L3";
  if (RESEARCHED_SOURCES.has(source)) return "L2";
  // 未识别来源（含数据库行缺失 source）一律按未核实处理，宁可少产出也不假装理解。
  return "L2";
}

const CAPABILITIES: Record<KnowledgeTier, TierCapabilities> = {
  L3: { multiDay: true, themeTour: true, zoneDriven: true, trailOrder: true, assertTransport: true },
  L2: { multiDay: false, themeTour: false, zoneDriven: false, trailOrder: true, assertTransport: false },
  L1: { multiDay: false, themeTour: false, zoneDriven: false, trailOrder: false, assertTransport: false },
};

export function tierCapabilities(tier: KnowledgeTier): TierCapabilities {
  return { ...CAPABILITIES[tier] };
}

export function capabilitiesFor(knowledge?: DestinationRouteKnowledge | null): { tier: KnowledgeTier; capabilities: TierCapabilities } {
  const tier = knowledgeTier(knowledge);
  const capabilities = tierCapabilities(tier);
  // L1 没有任何站点顺序知识时也不该用 trail 顺序；zone 类能力还依赖数据本身存在，
  // 这里做一次与数据实际形态的与运算，避免出现"授权了但无数据可用"的空判。
  if (!knowledge?.trails?.length) capabilities.trailOrder = false;
  if (!knowledge?.zones?.length) capabilities.zoneDriven = false;
  if (!knowledge?.edges?.length) capabilities.assertTransport = false;
  return { tier, capabilities };
}

export const TIER_LABEL: Record<KnowledgeTier, string> = {
  L3: "已验证（人工策展或创作者确认）",
  L2: "自动研究/策展顺序，未经核实",
  L1: "无路线知识",
};
