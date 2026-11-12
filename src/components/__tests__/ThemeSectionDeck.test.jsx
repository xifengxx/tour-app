// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import ThemeSectionDeck from '../ThemeSectionDeck';

const sections = [
  { key: 'core', name: '北岳恒山', kind: '核心景区', text: '从三元宫上山，天峰岭收尾。', stops: ['a', 'b', 'c', 'd'] },
  { key: 'area-x', name: '大同古城', kind: '周边景点', text: '城墙带状公园。', stops: ['e', 'f'] },
];

const locationsById = {
  a: { id: 'a', name: '三元宫' },
  b: { id: 'b', name: '天峰岭' },
  c: { id: 'c', name: '悬空寺' },
  d: { id: 'd', name: '翠屏山-三清殿' },
  e: { id: 'e', name: '大同东城墙' },
  f: { id: 'f', name: '带状公园' },
};

const legs = [
  { fromId: 'd', toId: 'e', mode: 'car', distanceM: 58000 },
];

// 组件是受控的（展开状态由外部 activeKey 决定），测试里用一层 state 包起来模拟真实用法
function Deck(props) {
  const [key, setKey] = useState(null);
  return <ThemeSectionDeck {...props} activeKey={key} onSelectSection={(k) => setKey(k)} />;
}

describe('ThemeSectionDeck', () => {
  it('片区一级视图显示片区数、核心/周边与点位数', () => {
    render(<Deck sections={sections} locationsById={locationsById} legs={legs} />);
    expect(screen.getByText(/本主题含 2 个片区/)).toBeInTheDocument();
    expect(screen.getByText('北岳恒山')).toBeInTheDocument();
    expect(screen.getByText('核心')).toBeInTheDocument();
    expect(screen.getByText('周边')).toBeInTheDocument();
    expect(screen.getAllByText(/个点/).length).toBeGreaterThan(0);
  });

  it('展开片区才显示玩法说明与点芯片', () => {
    render(<Deck sections={sections} locationsById={locationsById} legs={legs} />);
    expect(screen.queryByText('三元宫')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('北岳恒山'));
    expect(screen.getByText('三元宫')).toBeInTheDocument();
    expect(screen.getByText('从三元宫上山，天峰岭收尾。')).toBeInTheDocument();
  });

  it('片区之间的接驳取 route.legs 的跨片区分段距离', () => {
    render(<Deck sections={sections} locationsById={locationsById} legs={legs} />);
    expect(screen.getByText(/约 58 公里/)).toBeInTheDocument();
  });

  it('点芯片回传 onSelectSpot', () => {
    const onSelectSpot = vi.fn();
    render(
      <Deck
        sections={sections}
        locationsById={locationsById}
        legs={legs}
        onSelectSpot={onSelectSpot}
      />,
    );
    fireEvent.click(screen.getByText('北岳恒山'));
    fireEvent.click(screen.getByText('悬空寺'));
    expect(onSelectSpot).toHaveBeenCalledWith('c', sections[0]);
  });
});
