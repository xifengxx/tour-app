// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import RouteSectionsEditor from '../RouteSectionsEditor';

const locations = [
  { id: 'a', name: '冰川公园栈道' }, { id: 'b', name: '甘海子' },
  { id: 'c', name: '蓝月谷' }, { id: 'd', name: '云杉坪' },
];
const baseRoute = {
  id: 'r1', title: '深度主题游', stops: ['a', 'b', 'c', 'd'],
  sections: [
    { key: 'core', name: '玉龙雪山', kind: '核心景区', stops: ['a', 'b'], text: '' },
    { key: 'area-1', name: '蓝月谷', kind: '周边景点', stops: [], text: '' },
  ],
};

const setup = (route = baseRoute) => {
  const onChange = vi.fn();
  render(<RouteSectionsEditor route={route} locations={locations} onChange={onChange} />);
  return { onChange };
};

describe('RouteSectionsEditor', () => {
  it('线性行程给出分组入口，而不是硬塞一个空编辑器', () => {
    const { onChange } = setup({ id: 'r2', title: '一日', stops: ['a', 'b'], sections: [] });
    expect(screen.queryAllByText('冰川公园栈道')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '按景区分组' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      sections: [expect.objectContaining({ kind: '核心景区', stops: ['a', 'b'] })],
    }));
  });

  it('片区可改名、改类型、调先后', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getAllByLabelText('片区名称')[0], { target: { value: '雪山核心' } });
    expect(onChange.mock.calls[0][0].sections[0].name).toBe('雪山核心');
    fireEvent.change(screen.getAllByLabelText('片区类型')[0], { target: { value: '周边景点' } });
    expect(onChange.mock.calls[1][0].sections[0].kind).toBe('周边景点');
    fireEvent.click(screen.getAllByTitle('下移片区')[0]);
    expect(onChange.mock.calls[2][0].sections.map(s => s.key)).toEqual(['area-1', 'core']);
  });

  it('站点可以从未归组挑进片区，也可以移出去', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('把 云杉坪 归入片区'), { target: { value: 'area-1' } });
    const [call] = onChange.mock.calls;
    expect(call[0].sections.find(x => x.key === 'area-1').stops).toEqual(['d']);
    expect(call[0].sections.find(x => x.key === 'core').stops).toEqual(['a', 'b']);
    // 扁平序列 = 片区顺序拼接 + 未归组补在后面：一个站点都没丢，顺序跟着片区走
    expect(call[0].stops).toEqual(['a', 'b', 'd', 'c']);
    expect(call[0].stops.sort()).toEqual(['a', 'b', 'c', 'd']);
    fireEvent.click(screen.getAllByTitle('移出本片区')[0]);
    expect(onChange.mock.calls[1][0].sections[0].stops).toEqual(['b']);
  });

  it('删除片区不丢站点，站点退回未归组', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getAllByTitle('删除片区（站点退回未归组）')[0]);
    const { sections, stops } = onChange.mock.calls[0][0];
    expect(sections).toHaveLength(1);
    expect(stops).toEqual(['a', 'b', 'c', 'd']); // 一个都没丢
  });

  it('片区内可调序，首项不能再前移', () => {
    const { onChange } = setup();
    const first = screen.getAllByTitle('片区内前移')[0];
    fireEvent.click(first);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTitle('片区内后移')[0]);
    expect(onChange.mock.calls[0][0].sections[0].stops).toEqual(['b', 'a']);
  });

  it('空片区给出显式提醒，避免留下没有内容的分组', () => {
    setup();
    expect(screen.getByText(/该片区还没有游览点/)).toBeInTheDocument();
    expect(screen.getByText(/空片区：蓝月谷/)).toBeInTheDocument();
  });

  it('新片区同名也能各自存在（key 不冲突）', () => {
    const { onChange } = setup({ ...baseRoute, sections: [
      { key: 'x', name: '蓝月谷', kind: '周边景点', stops: ['c'], text: '' },
    ] });
    fireEvent.change(screen.getByPlaceholderText(/新片区名称/), { target: { value: '蓝月谷' } });
    fireEvent.click(screen.getByRole('button', { name: /添加片区/ }));
    const { sections, stops } = onChange.mock.calls[0][0];
    expect(new Set(sections.map(x => x.key)).size).toBe(sections.length); // key 不冲突，站点归属不会串片区
    expect(sections.map(x => x.name)).toEqual(['蓝月谷', '蓝月谷']);
    expect([...stops].sort()).toEqual(['a', 'b', 'c', 'd']); // 一个点都没丢，顺序按片区重排
  });
});
