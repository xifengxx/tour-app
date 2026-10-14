import { describe, it, expect } from 'vitest';
import { normalizeTour, computeBounds } from '../useTourData';

describe('normalizeTour', () => {
  it('Supabase 平表 → 嵌套导览对象（layers/地点/路线/提示）', () => {
    const row = {
      id: 't1',
      user_id: 'u1',
      title: '测试导览',
      subtitle: '副标题',
      destination: { name: '测试山', bounds: [[10, 100], [20, 110]] },
      content_layers: [{ layer_key: 'novel', name: '小说场景', icon: '📖', color: '#c0392b' }],
      locations: [{ id: 'l1', name: '甲峰', lat: 28, lng: 118, importance: 5, layers: { novel: { text: 'x' } } }],
      routes: [{
        id: 'r1', day_label: '第1天', title: '线路', stops: ['l1'], narrative: 'n',
        prof: [{ km: 0, m: 1000 }, { km: 1, m: 1100 }],
      }],
      tips: [{ text: '提示' }],
    };
    const t = normalizeTour(row);
    expect(t.id).toBe('t1');
    expect(t.meta.title).toBe('测试导览');
    expect(t.contentLayers[0]).toEqual({ id: 'novel', name: '小说场景', icon: '📖', color: '#c0392b' });
    expect(t.locations[0]).toMatchObject({ id: 'l1', name: '甲峰' });
    expect(t.routes[0].day).toBe('第1天'); // day_label → day
    expect(t.routes[0].prof).toEqual([[0, 1000], [1, 1100]]);
    expect(t.tips).toEqual([{ text: '提示' }]);
  });

  it('无 destination.bounds 时 computeBounds 兜底', () => {
    const row = {
      id: 't2',
      title: '无边界',
      user_id: 'u1',
      destination: { name: '山' },
      locations: [{ id: 'l1', lat: 20, lng: 100 }, { id: 'l2', lat: 30, lng: 110 }],
      routes: [],
      content_layers: [],
      tips: [],
    };
    expect(normalizeTour(row).destination.bounds).toEqual([[20, 100], [30, 110]]);
  });

  it('无坐标 → bounds 为 null', () => {
    const row = {
      id: 't3', title: '空', user_id: 'u1', destination: {},
      locations: [], routes: [], content_layers: [], tips: [],
    };
    expect(normalizeTour(row).destination.bounds).toBeNull();
  });
});

describe('computeBounds', () => {
  it('计算 min/max 边界', () => {
    expect(computeBounds([{ lat: 30, lng: 110 }, { lat: 20, lng: 100 }])).toEqual([[20, 100], [30, 110]]);
  });

  it('空数组或无数值 → null', () => {
    expect(computeBounds([])).toBeNull();
    expect(computeBounds([{ lat: 0, lng: 0 }])).toBeNull();
  });
});

describe('normalizeTour 主题游分区（v93）', () => {
  it('把 stopIds 归一化成 stops，并按片区分核心与周边', () => {
    const tour = normalizeTour({
      id: 't1', title: 'T', content_layers: [], tips: [],
      locations: [{ id: 'a', name: 'A', lat: 1, lng: 1 }],
      routes: [{ id: 'r1', day_label: '主题游', title: '深度', stops: ['a'], sections: [
        { key: 'core', name: '目的地', kind: '核心景区', stopIds: ['a'], text: '玩法' },
      ] }],
    });
    expect(tour.routes[0].sections).toEqual([
      { key: 'core', name: '目的地', kind: '核心景区', stops: ['a'], text: '玩法' },
    ]);
  });

  it('线性路线与历史数据（无 sections）退化为空数组，不炸渲染', () => {
    const tour = normalizeTour({
      id: 't2', title: 'T', content_layers: [], tips: [],
      locations: [], routes: [{ id: 'r1', day_label: '1日精华游', stops: [], legs: [] }],
    });
    expect(tour.routes[0].sections).toEqual([]);
  });

  it('未知 kind 归为周边景点', () => {
    const tour = normalizeTour({
      id: 't3', title: 'T', content_layers: [], tips: [], locations: [],
      routes: [{ id: 'r', day_label: '主题游', stops: [], sections: [{ name: 'X', stopIds: [], kind: '怪' }] }],
    });
    expect(tour.routes[0].sections[0].kind).toBe('周边景点');
  });
});
