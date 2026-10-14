import { describe, expect, it } from 'vitest';
import {
  addSection, flattenStops, groupSummary, moveSection, moveStopToSection,
  normalizeSections, removeSection, reorderStopInSection, sectionForStop,
  sectionsForDb, toggleStopInSection, ungroupedStops, updateSection,
} from '../routeSections';

const stops = ['a', 'b', 'c', 'd', 'e'];
const sections = [
  { key: 'core', name: '玉龙雪山', kind: '核心景区', stops: ['a', 'b'], text: '索道上下' },
  { key: 'area-1', name: '蓝月谷', kind: '周边景点', stops: ['c'], text: '' },
];

describe('normalizeSections', () => {
  it('兼容落库的 stopIds 字段并剔除已不存在的站点', () => {
    const db = [{ key: 'core', name: 'X', kind: '核心景区', stopIds: ['a', 'ghost'] }];
    expect(normalizeSections(db, ['a', 'b'])).toEqual([
      { key: 'core', name: 'X', kind: '核心景区', stops: ['a'], text: '' },
    ]);
  });

  it('脏 kind 归一、重复 key 自动改名、空输入返回空数组', () => {
    const [first, second] = normalizeSections(
      [{ key: 'k', name: 'A', kind: '怪', stops: [] }, { key: 'k', name: 'B', stops: [] }],
      stops,
    );
    expect(first.kind).toBe('周边景点');
    expect(second.key).not.toBe(first.key);
    expect(normalizeSections([{ key: 'k', name: 'A', stops: [] }, { key: 'k', name: 'B', stops: [] }], stops)).toHaveLength(2);
    expect(normalizeSections(null, stops)).toEqual([]);
    expect(normalizeSections(undefined, [])).toEqual([]);
  });
});

describe('分区与扁平序列的一致性', () => {
  it('flattenStops 保证未分组站点不被吞掉', () => {
    expect(flattenStops(sections, stops)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(ungroupedStops(sections, stops)).toEqual(['d', 'e']);
    expect(groupSummary(sections, stops).groupedCount).toBe(3);
  });

  it('round trip 到落库形状再读回，信息不丢', () => {
    const db = sectionsForDb(sections);
    expect(db[0].stopIds).toEqual(['a', 'b']);
    expect(normalizeSections(db, stops)).toEqual(sections);
  });
});

describe('站点归属', () => {
  it('一个站点同时只属于一个片区', () => {
    const next = toggleStopInSection(sections, 'c', 'core');
    expect(next.find(s => s.key === 'core').stops).toEqual(['a', 'b', 'c']);
    expect(next.find(s => s.key === 'area-1').stops).toEqual([]);
    expect(sectionForStop(next, 'c').name).toBe('玉龙雪山');
  });

  it('再点一次同一片区即取消归组', () => {
    const off = toggleStopInSection(sections, 'a', 'core');
    expect(off.find(s => s.key === 'core').stops).toEqual(['b']);
    expect(sectionForStop(off, 'a')).toBeNull();
  });

  it('moveStopToSection(null) 退回未分组', () => {
    const off = moveStopToSection(sections, 'c', null);
    expect(ungroupedStops(off, stops)).toEqual(['c', 'd', 'e']);
  });

  it('片区内调序不会越界', () => {
    expect(reorderStopInSection(sections, 'core', 'a', 1).find(s => s.key === 'core').stops).toEqual(['b', 'a']);
    expect(reorderStopInSection(sections, 'core', 'a', -5).find(s => s.key === 'core').stops).toEqual(['a', 'b']);
    expect(reorderStopInSection(sections, 'core', 'zz', 1).find(s => s.key === 'core').stops).toEqual(['a', 'b']);
  });
});

describe('片区管理', () => {
  it('同名片区会得到不同 key', () => {
    const withDup = addSection(addSection(sections, '蓝月谷'), '蓝月谷');
    expect(withDup.map(s => s.key)).toEqual(['core', 'area-1', 'sec-蓝月谷', 'sec-蓝月谷-2']);
  });

  it('删除片区不会丢站点，只是变未分组', () => {
    const after = removeSection(sections, 'area-1');
    expect(after).toHaveLength(1);
    expect(ungroupedStops(after, stops)).toEqual(['c', 'd', 'e']);
    expect(flattenStops(after, stops)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('片区可改名改类型、可上下移动（推荐游玩顺序）', () => {
    expect(updateSection(sections, 'area-1', { name: '蓝月谷景区', kind: '核心景区' })[1]).toMatchObject({
      name: '蓝月谷景区', kind: '核心景区',
    });
    expect(moveSection(sections, 'area-1', -1).map(s => s.key)).toEqual(['area-1', 'core']);
    expect(moveSection(sections, 'core', -1).map(s => s.key)).toEqual(['core', 'area-1']); // 已在首位不动
  });

  it('汇总提示会点出空片区，避免留下没内容的分组', () => {
    const withEmpty = addSection(sections, '新片区');
    const summary = groupSummary(withEmpty, stops);
    expect(summary.emptySections).toEqual(['新片区']);
    expect(summary.sectionCount).toBe(3);
  });
});
