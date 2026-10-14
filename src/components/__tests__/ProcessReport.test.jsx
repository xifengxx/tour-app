// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProcessReport, { RouteIssueList } from '../ProcessReport';
import { summarizeReport } from '../../lib/routeReport';

const report = {
  locations: 17, routes: 3, plans: 3, rejected: 3,
  routeKnowledge: { source: 'auto-research', confidence: 0.75, destination: '玉龙雪山' },
  routeGraph: { checked: 3, issues: 1, estimatedMinutes: 834 },
  warnings: [
    '⚠️ "黑水河" 坐标位于 青海省，不在 云南，已跳过',
    '🧭 路线「2日全景游」牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接',
  ],
};
const routes = [
  { id: 'r1', day: '1日精华游', title: '一日' },
  { id: 'r2', day: '2日全景游', title: '两日' },
];

describe('ProcessReport', () => {
  it('无报告时不渲染，避免旧导览出现空面板', () => {
    const { container } = render(<ProcessReport summary={summarizeReport(null, routes)} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('有待核实项时默认展开并显示计数徽标', () => {
    render(<ProcessReport summary={summarizeReport(report, routes)} />);
    expect(screen.getByText('AI 处理报告')).toBeInTheDocument();
    expect(screen.getByText('1 项待核实')).toBeInTheDocument();
    expect(screen.getByText(/牦牛坪 → 丽江玉水寨/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 处理报告/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('闸门阻断时改用阻断措辞，并说明需核实后才能发布', () => {
    const gated = {
      ...report,
      gate: { blocking: [{ label: '2日全景游', message: '牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接' }] },
    };
    render(<ProcessReport summary={summarizeReport(gated, routes)} />);
    expect(screen.getByText('1 项需核实后才能发布')).toBeInTheDocument();
    expect(screen.getByText(/本导览需核实后才能发布/)).toBeInTheDocument();
  });

  it('闸门收回公开状态时如实说明，不假装是创作者自己关的', () => {
    const gated = {
      ...report,
      gate: { blocking: [{ label: '2日全景游', message: '牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接' }], unpublished: true },
    };
    render(<ProcessReport summary={summarizeReport(gated, routes)} />);
    expect(screen.getByText(/已自动转为私有/)).toBeInTheDocument();
  });

  it('可折叠，键盘可操作', () => {
    render(<ProcessReport summary={summarizeReport(report, routes)} />);
    const toggle = screen.getByRole('button', { name: /AI 处理报告/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/牦牛坪/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText(/牦牛坪/)).toBeInTheDocument();
  });

  it('知识未经人工核实时必须提示创作者逐条确认', () => {
    render(<ProcessReport summary={summarizeReport(report, routes)} />);
    expect(screen.getByText(/尚未经人工核实/)).toBeInTheDocument();
    expect(screen.getByText(/auto-research/)).toBeInTheDocument();
  });

  it('策展知识且无问题时显示"无明显结构问题"并默认收起', () => {
    const summary = summarizeReport({
      locations: 12, routes: 2, plans: 2,
      routeKnowledge: { source: 'curated', confidence: 0.9 },
      routeGraph: { checked: 2, issues: 0 },
      warnings: [],
    }, routes);
    render(<ProcessReport summary={summary} />);
    expect(screen.getByText('无明显结构问题')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI 处理报告/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('RouteIssueList', () => {
  it('无问题时不占位', () => {
    const { container } = render(<RouteIssueList issues={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('阻断级问题使用阻断措辞', () => {
    render(<RouteIssueList issues={[{ text: '日观峰 → 岱庙 高差约 1386m，资料中无衔接方式', level: 'blocking' }]} />);
    expect(screen.getByText('需核实后才能发布：1 项')).toBeInTheDocument();
    expect(screen.getByText(/日观峰 → 岱庙/)).toBeInTheDocument();
  });

  it('推断级问题说明来源是系统按距离/高差推断', () => {
    render(<RouteIssueList issues={[{ text: '牦牛坪 → 玉水寨 相距约 19km', level: 'advisory' }]} />);
    expect(screen.getByText(/1 项交通衔接由系统按距离/)).toBeInTheDocument();
    expect(screen.getByText(/牦牛坪 → 玉水寨/)).toBeInTheDocument();
  });
});

describe('ProcessReport 能力分层提示（v89）', () => {
  const tieredReport = {
    locations: 13, routes: 1, plans: 1,
    routeKnowledge: { source: 'auto-research', confidence: 0.75, destination: '玉龙雪山', capabilities: { multiDay: false, themeTour: false, zoneDriven: false } },
    knowledgeTier: 'L2',
    knowledgeTierLabel: '自动研究/策展顺序，未经核实',
    suppressedPlans: [
      { plan: '2日全景游', reason: '目的地路线知识未经核实，无法确认分区间换乘与第二天可达性' },
      { plan: '主题游', reason: '目的地路线知识未经核实，无法确认跨片区接驳可行性' },
    ],
    warnings: [],
  };

  it('说明当前分级与为什么只产出保守路线', () => {
    render(<ProcessReport summary={summarizeReport(tieredReport, routes)} />);
    expect(screen.getByText(/L2 · 自动研究\/策展顺序，未经核实/)).toBeInTheDocument();
    expect(screen.getByText(/本轮只产出保守路线/)).toBeInTheDocument();
  });

  it('列出未生成的路线类型并给出解锁方式', () => {
    render(<ProcessReport summary={summarizeReport(tieredReport, routes)} />);
    expect(screen.getByText('未生成的路线（2 类）')).toBeInTheDocument();
    expect(screen.getByText(/2日全景游/)).toBeInTheDocument();
    expect(screen.getByText(/主题游/)).toBeInTheDocument();
    expect(screen.getByText(/解锁方式/)).toBeInTheDocument();
  });

  it('v89 之前的报告没有分级字段时不显示分级段', () => {
    render(<ProcessReport summary={summarizeReport({ locations: 5, routes: 2, plans: 2 }, routes)} />);
    expect(screen.queryByText(/路线知识分级/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未生成的路线/)).not.toBeInTheDocument();
  });
});
