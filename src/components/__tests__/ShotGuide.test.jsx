// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ShotGuide from '../ShotGuide';
import { storySeedFor } from '../../lib/storySeed';

const shots = [
  {
    title: '如琴湖东岸步道',
    position: '沿湖东侧步道',
    direction: '面西偏北',
    formula: '松枝压左 1/3，人物右下三分点，竖构图 4:5',
    time: '清晨 7:00–8:30',
    avoid: '正午顶光',
  },
];

describe('机位卡片 (ShotGuide)', () => {
  it('没有机位数据就不渲染，不占位', () => {
    const { container } = render(<ShotGuide shots={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('默认收起：只露出标题和数量，不显示具体字段', () => {
    render(<ShotGuide shots={shots} />);
    expect(screen.getByText('机位 · 构图')).toBeInTheDocument();
    expect(screen.getByText('1 处')).toBeInTheDocument();
    expect(screen.queryByText('沿湖东侧步道')).toBeNull();
  });

  it('展开后四件事齐备：站哪 / 朝哪 / 怎么构 / 时段，并单独标出避开', () => {
    render(<ShotGuide shots={shots} />);
    fireEvent.click(screen.getByText('机位 · 构图'));
    expect(screen.getByText('如琴湖东岸步道')).toBeInTheDocument();
    expect(screen.getByText('站哪')).toBeInTheDocument();
    expect(screen.getByText('朝哪')).toBeInTheDocument();
    expect(screen.getByText('怎么构')).toBeInTheDocument();
    expect(screen.getByText('时段')).toBeInTheDocument();
    expect(screen.getByText('避开')).toBeInTheDocument();
    expect(screen.getByText('沿湖东侧步道')).toBeInTheDocument();
  });

  it('详情弹层里用 defaultOpen 直接铺开，不用再点一次', () => {
    render(<ShotGuide shots={shots} defaultOpen />);
    expect(screen.getByText('沿湖东侧步道')).toBeInTheDocument();
  });
});

describe('机位内容来源', () => {
  it('庐山 JSON 里每个地点都有机位，总量不少于地点数', () => {
    const seed = storySeedFor('b47e3d39-212f-44ff-acb4-7aa2b9b7ef6e');
    const all = Object.values(seed.locations);
    const withShot = all.filter(v => v.shot?.length);
    expect(withShot.length).toBe(all.length);
    expect(withShot.reduce((n, v) => n + v.shot.length, 0)).toBeGreaterThanOrEqual(all.length);
  });
});
