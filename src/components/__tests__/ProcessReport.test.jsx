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

  it('有问题时给出可读的待核实列表', () => {
    render(<RouteIssueList issues={[{ text: '日观峰 → 岱庙 高差约 1386m', level: 'blocking' }]} />);
    expect(screen.getByText('待核实：1 个交通/衔接问题')).toBeInTheDocument();
    expect(screen.getByText(/日观峰 → 岱庙/)).toBeInTheDocument();
  });
});
