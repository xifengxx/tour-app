/**
 * AI 处理质量报告的分组与分级（纯逻辑，可测试）。
 *
 * 背景：process-tour 已经把地点剔除、去重、路线图校验问题写进 tours.process_report，
 * 但审核页从未读取它（P1-1 之前前端 0 处引用）。本模块把那份报告转换成
 * 创作者能直接行动的结构：按路线归组的缺陷 + 全局告警 + 处理概况。
 */

// Edge Function 的告警用 emoji 前缀区分性质，沿用同一套语义做分级。
const ROUTE_ISSUE_RE = /^🧭\s*路线「(.+?)」\s*(.*)$/;

const KIND_BY_ICON = [
  [/^🧭/, 'route'],
  [/^⚠️|^⚠/, 'warn'],
  [/^♻️|^♻/, 'auto'],
  [/^📖|^🥾|^🌏|^🏔|^💡/, 'info'],
];

function classify(text) {
  for (const [re, kind] of KIND_BY_ICON) if (re.test(text)) return kind;
  return 'info';
}

/**
 * @param {object|null} report tours.process_report
 * @param {Array} routes 归一化后的路线列表（含 day / title）
 * @returns {{available:boolean, metrics:object, routeIssues:Array, general:Array, blockingCount:number}}
 */
export function summarizeReport(report, routes = []) {
  if (!report || typeof report !== 'object') {
    return { available: false, metrics: {}, routeIssues: [], general: [], blockingCount: 0 };
  }

  const graph = report.routeGraph || {};
  const knowledge = report.routeKnowledge || {};
  const metrics = {
    locations: Number(report.locations) || 0,
    routes: Number(report.routes) || 0,
    plans: Number(report.plans) || 0,
    rejected: Number(report.rejected) || 0,
    deduped: Number(report.deduped) || 0,
    knowledgeSource: knowledge.source || '未知',
    knowledgeConfidence: knowledge.confidence ?? null,
    knowledgeDestination: knowledge.destination || '',
    graphChecked: Number(graph.checked) || 0,
    graphIssues: Number(graph.issues) || 0,
    estimatedHours: graph.estimatedMinutes != null
      ? Math.round((Number(graph.estimatedMinutes) / 60) * 10) / 10
      : null,
    at: report.at || '',
  };

  // 闸门结论只认同一次生成写下的 report.gate。
  // 不能用新规则追溯封锁历史导览的发布权：v88 之前的告警没有分级，
  // 拿今天的阻断标准去判昨天的产物，会让所有存量导览突然无法发布。
  const gate = report.gate && typeof report.gate === 'object' ? report.gate : null;
  const gateBlocking = Array.isArray(gate?.blocking) ? gate.blocking : [];
  const gateKeys = new Set(gateBlocking.map(b => `${b.label || ''}|${b.message || ''}`));

  // 路线数少于计划数 = 有路线在生成中被丢弃，属于必须先给创作者看的硬信号。
  const droppedPlan = metrics.plans > metrics.routes
    ? { label: '路线组成', text: `计划生成 ${metrics.plans} 条路线，实际只落库 ${metrics.routes} 条，有路线被静默丢弃`, level: 'blocking' }
    : null;

  const byLabel = new Map();
  const general = [];
  for (const raw of Array.isArray(report.warnings) ? report.warnings : []) {
    const text = String(raw || '').trim();
    if (!text) continue;
    const routed = text.match(ROUTE_ISSUE_RE);
    if (routed) {
      const [, label, message] = routed;
      if (!byLabel.has(label)) byLabel.set(label, []);
      // 只有被闸门记名为 blocking 的才是阻断级；其余是"已推断、待核实"。
      const level = gateKeys.has(`${label}|${message || ''}`) ? 'blocking' : 'advisory';
      byLabel.get(label).push({ text: message || text, level });
      continue;
    }
    const kind = classify(text);
    general.push({ text, kind, level: kind === 'warn' ? 'warning' : kind === 'auto' ? 'auto' : 'info' });
  }
  if (droppedPlan) general.unshift(droppedPlan && { text: droppedPlan.text, kind: 'route', level: 'blocking' });

  const routeIssues = routes.map(route => ({
    routeId: route.id,
    label: route.day || '',
    title: route.title || '',
    issues: byLabel.get(route.day || '') || [],
  }));
  // 报告里有、但当前路线列表已不存在的告警（创作者删过路线）保留为全局项，避免信息丢失。
  for (const [label, issues] of byLabel) {
    if (!routes.some(r => (r.day || '') === label)) {
      routeIssues.push({ routeId: null, label, title: '（该路线已不在当前列表）', issues });
    }
  }

  const blockingCount = routeIssues.reduce((n, r) => n + r.issues.filter(i => i.level === 'blocking').length, 0)
    + general.filter(w => w.level === 'blocking').length;
  const reviewCount = routeIssues.reduce((n, r) => n + r.issues.length, 0);
  return {
    available: true,
    metrics,
    routeIssues,
    general,
    blockingCount,
    reviewCount,
    // 闸门阻断时不允许直接发布；advisory 只提示核实。
    canPublish: blockingCount === 0,
    unpublished: Boolean(gate?.unpublished),
    repairs: Number(gate?.repairs) || 0,
    gateSource: gate ? 'v88+' : 'legacy',
  };
}

export function issuesForRoute(summary, route) {
  if (!summary?.available || !route) return [];
  const hit = (summary.routeIssues || []).find(r => r.routeId === route.id);
  if (hit) return hit.issues;
  return (summary.routeIssues || []).find(r => r.label === (route.day || ''))?.issues || [];
}
