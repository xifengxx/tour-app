import { describe, expect, it } from 'vitest';
import { issuesForRoute, summarizeReport } from '../routeReport';

// 取线上真实结构：丽江玉龙雪山（2026-10-13）与北岳恒山（2026-09-02）的处理报告。
const lijiangReport = {
  locations: 17, routes: 3, plans: 3, rejected: 3, deduped: 0,
  corePool: 13, coreScenic: '冰川公园', mainScenic: '',
  routeKnowledge: { source: 'auto-research', confidence: 0.75, destination: '玉龙雪山' },
  routeGraph: { checked: 3, issues: 1, estimatedMinutes: 834 },
  warnings: [
    '⚠️ "黑水河" 坐标(101.194291,37.602565)位于 青海省海北藏族自治州，不在 云南，已跳过',
    '🌏 自动并入 4 个地区知名景点（可组主题游）',
    '🧭 路线「2日全景游」牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接',
  ],
  at: '2026-10-13T14:00:00.000Z',
};
const routes = [
  { id: 'r1', day: '1日精华游', title: '玉龙雪山一日精华游' },
  { id: 'r2', day: '2日全景游', title: '玉龙雪山两日全景游' },
  { id: 'r3', day: '主题游', title: '玉龙雪山深度主题游' },
];

describe('summarizeReport', () => {
  it('报告缺失时标记为不可用，不抛错', () => {
    expect(summarizeReport(null, routes).available).toBe(false);
    expect(summarizeReport(undefined, routes).routeIssues).toEqual([]);
    expect(summarizeReport('bad', routes).available).toBe(false);
  });

  it('按路线标签归组交通衔接缺陷', () => {
    const summary = summarizeReport(lijiangReport, routes);
    expect(summary.available).toBe(true);
    expect(summary.reviewCount).toBe(1);
    const day2 = summary.routeIssues.find(r => r.label === '2日全景游');
    expect(day2.issues[0].text).toContain('牦牛坪 → 丽江玉水寨');
    expect(summary.routeIssues.find(r => r.label === '1日精华游').issues).toEqual([]);
  });

  it('历史报告只标为待核实，不追溯封锁发布权', () => {
    // v88 之前的 report 没有 gate 字段，也没有分级。
    // 用今天的阻断标准去判昨天的产物，会让所有存量导览突然无法发布。
    const summary = summarizeReport(lijiangReport, routes);
    expect(summary.gateSource).toBe('legacy');
    expect(summary.routeIssues.find(r => r.label === '2日全景游').issues[0].level).toBe('advisory');
    expect(summary.reviewCount).toBe(1);
    expect(summary.blockingCount).toBe(0);
    expect(summary.canPublish).toBe(true);
  });

  it('v88 闸门记名为 blocking 的问题才阻断发布', () => {
    const gated = {
      ...lijiangReport,
      gate: {
        blocking: [{ label: '2日全景游', message: '牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接' }],
        repairs: 1,
        routes: 3,
        plans: 3,
      },
    };
    const summary = summarizeReport(gated, routes);
    expect(summary.gateSource).toBe('v88+');
    expect(summary.routeIssues.find(r => r.label === '2日全景游').issues[0].level).toBe('blocking');
    expect(summary.blockingCount).toBe(1);
    expect(summary.canPublish).toBe(false);
    expect(summary.repairs).toBe(1);
  });

  it('闸门自动收回公开状态时如实告知创作者', () => {
    const summary = summarizeReport({ ...lijiangReport, gate: { blocking: [{ label: '2日全景游', message: '牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接' }], unpublished: true } }, routes);
    expect(summary.unpublished).toBe(true);
    expect(summary.canPublish).toBe(false);
  });

  it('路线级缺陷不混进全局告警，全局告警保留性质分级', () => {
    const summary = summarizeReport(lijiangReport, routes);
    expect(summary.general.some(w => w.text.startsWith('🧭'))).toBe(false);
    expect(summary.general.find(w => w.text.includes('黑水河')).level).toBe('warning');
    expect(summary.general.find(w => w.text.includes('自动并入')).level).toBe('info');
  });

  it('暴露知识可信度与概况指标供审核页判读', () => {
    const { metrics } = summarizeReport(lijiangReport, routes);
    expect(metrics.knowledgeSource).toBe('auto-research');
    expect(metrics.knowledgeConfidence).toBe(0.75);
    expect(metrics.rejected).toBe(3);
    expect(metrics.graphIssues).toBe(1);
    expect(metrics.estimatedHours).toBe(13.9);
  });

  it('计划路线多于落库路线时报为阻断级组成缺陷', () => {
    const summary = summarizeReport({ ...lijiangReport, plans: 4, routes: 1 }, routes);
    const blocking = summary.general.filter(w => w.level === 'blocking');
    expect(blocking).toHaveLength(1);
    expect(summary.canPublish).toBe(false);
    expect(blocking[0].text).toContain('计划生成 4 条');
    expect(blocking[0].text).toContain('实际只落库 1 条');
  });

  it('创作者已删除的路线其历史告警不丢失', () => {
    const summary = summarizeReport(lijiangReport, [routes[0], routes[2]]);
    const orphan = summary.routeIssues.find(r => r.label === '2日全景游');
    expect(orphan).toBeTruthy();
    expect(orphan.routeId).toBeNull();
    expect(orphan.issues[0].text).toContain('牦牛坪');
  });

  it('兼容无 routeGraph / 无 warnings 的旧报告（恒山及更早）', () => {
    const summary = summarizeReport({ locations: 16, routes: 2, warnings: undefined }, []);
    expect(summary.available).toBe(true);
    expect(summary.blockingCount).toBe(0);
    expect(summary.metrics.graphIssues).toBe(0);
    expect(summary.metrics.estimatedHours).toBeNull();
  });

  it('issuesForRoute 先按 id 命中，再按标签兜底', () => {
    const summary = summarizeReport(lijiangReport, routes);
    expect(issuesForRoute(summary, routes[1])).toHaveLength(1);
    expect(issuesForRoute(summary, { id: 'unknown', day: '2日全景游' })).toHaveLength(1);
    expect(issuesForRoute(summary, routes[0])).toEqual([]);
    expect(issuesForRoute({ available: false }, routes[1])).toEqual([]);
  });
});
