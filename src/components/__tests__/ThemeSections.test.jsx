// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ThemeSections from '../ThemeSections';

const sections = [
  { key: 'core', name: '玉龙雪山', kind: '核心景区', stops: ['a', 'b'], text: '大索道上冰川公园，栈道观景。' },
  { key: 'area-1', name: '蓝月谷', kind: '周边景点', stops: ['c'], text: '' },
  { key: 'area-2', name: '云杉坪', kind: '周边景点', stops: ['d', 'e'], text: '' },
];
const locationsById = {
  a: { id: 'a', name: '冰川公园栈道' }, b: { id: 'b', name: '甘海子' },
  c: { id: 'c', name: '蓝月谷' }, d: { id: 'd', name: '云杉坪索道上部站' }, e: { id: 'e', name: '牦牛坪' },
};

describe('ThemeSections', () => {
  it('两个以上片区才启用分区视图（线性行程不加戏）', () => {
    expect(render(<ThemeSections sections={[sections[0]]} locationsById={locationsById} />).container).toBeEmptyDOMElement();
    expect(render(<ThemeSections sections={[]} locationsById={locationsById} />).container).toBeEmptyDOMElement();
    expect(render(<ThemeSections />).container).toBeEmptyDOMElement();
  });

  it('按 主题 → 片区 → 片区内游览点 的层次展示', () => {
    render(<ThemeSections sections={sections} locationsById={locationsById} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('玉龙雪山')).toBeInTheDocument();
    expect(screen.getByText('本主题含 3 个片区，每个片区内按实际动线排列')).toBeInTheDocument();
    // 核心与周边要区分，否则用户不知道哪个是目的地本身
    expect(screen.getAllByText('核心')).toHaveLength(1);
    expect(screen.getAllByText('周边')).toHaveLength(2);
  });

  it('片区内按顺序连线展示，并可点选到具体地点', () => {
    const onSelectSpot = vi.fn();
    render(<ThemeSections sections={sections} locationsById={locationsById} onSelectSpot={onSelectSpot} />);
    const glacier = screen.getByText('云杉坪').closest('li');
    expect(within(glacier).getByText('云杉坪索道上部站')).toBeInTheDocument();
    fireEvent.click(within(glacier).getByText('牦牛坪'));
    expect(onSelectSpot).toHaveBeenCalledWith('e', expect.objectContaining({ name: '云杉坪' }));
  });

  it('AI 没写片区文案时不显示空段落', () => {
    const { container } = render(<ThemeSections sections={sections} locationsById={locationsById} />);
    expect(screen.getByText(/大索道上冰川公园/)).toBeInTheDocument();
    // 只有有文案的片区才产生批注段落：core(1) + 无其他
    expect(container.querySelectorAll('.font-kai')).toHaveLength(1);
    // 片区名仍然展示（与同名游览点各自一处）
    expect(screen.getAllByText('蓝月谷').length).toBeGreaterThanOrEqual(1);
  });
});
