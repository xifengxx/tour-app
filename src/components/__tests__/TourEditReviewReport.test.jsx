// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import TourEditReview from '../TourEditReview';

// P1-1 接线验证：报告必须经 TourEdit → TourEditReview → 审核页真正落地，
// 而不只是存在一个孤立的展示组件（历史上 process_report 就是卡在这一步）。
const noop = () => {};
const props = {
  locations: [{ id: 'a', name: '牦牛坪', importance: 4 }, { id: 'b', name: '丽江玉水寨', importance: 3 }],
  routes: [{ id: 'r2', day: '2日全景游', title: '玉龙雪山两日全景游', narrative: '', stops: ['a', 'b'] }],
  contentLayers: [],
  editingLoc: null,
  editingLayer: null,
  isPublic: false,
  onSetPhase: noop, setIsPublic: noop, onShowMapSearch: noop,
  onSetEditingLoc: noop, onSetEditingLayer: noop,
  updateLocation: noop, removeLocation: noop, updateLayerContent: noop,
  addRoute: noop, updateRoute: noop, removeRoute: noop, toggleRouteStop: noop,
  onReprocess: noop,
};
const report = {
  locations: 17, routes: 3, plans: 3,
  routeKnowledge: { source: 'auto-research', confidence: 0.75 },
  routeGraph: { checked: 3, issues: 1, estimatedMinutes: 372 },
  warnings: ['🧭 路线「2日全景游」牦牛坪 → 丽江玉水寨 相距约 19km，但缺少索道/观光车/专车衔接'],
};

describe('TourEditReview 质量报告接线', () => {
  it('没有报告时不渲染报告面板（旧导览/未处理草稿）', () => {
    render(<TourEditReview {...props} processReport={null} />);
    expect(screen.queryByText('AI 处理报告')).not.toBeInTheDocument();
  });

  it('有报告时在审核页显示，并且缺陷同时出现在总览与对应路线卡片内', () => {
    render(<TourEditReview {...props} processReport={report} />);
    expect(screen.getByText('AI 处理报告')).toBeInTheDocument();
    // 同一处缺陷出现两次：报告总览一次、路线卡片内一次
    // （用"相距约 19km"限定，避免与路线卡片原有的"途经:"行文本混淆）
    expect(screen.getAllByText(/相距约 19km/)).toHaveLength(2);
    expect(screen.getByText('待核实：1 个交通/衔接问题')).toBeInTheDocument();
  });
});
