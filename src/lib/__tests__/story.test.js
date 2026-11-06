import { describe, it, expect } from 'vitest';
import { applyStorySeed, summarizeStory } from '../story';
import { storySeedFor } from '../storySeed';

const locById = {
  a: { id: 'a', name: '甲寺', timeline: [{ era: '东晋', label: '入库条目', evidence: '《甲书》' }], figures: [] },
  b: { id: 'b', name: '乙峰' },
};

const seed = {
  tourId: 't1',
  locations: {
    a: { timeline: [{ era: '唐代', label: '不该覆盖入库值' }], figures: [{ name: '某人' }] },
    b: { timeline: [{ era: '民国', label: '兜底条目', evidence: '《乙志》' }], figures: [{ name: '某人', works: ['《乙集》'] }] },
    ghost: { timeline: [{ era: '不存在', label: '不应出现' }] },
  },
};

describe('applyStorySeed 案头兜底', () => {
  it('库里有值就用库里的，不用 JSON 覆盖', () => {
    const merged = applyStorySeed(locById, seed);
    expect(merged.a.timeline[0].label).toBe('入库条目');
    expect(merged.a.figures).toHaveLength(1); // figures 库里空，用兜底补上
  });

  it('库里缺的字段用 JSON 补，不存在的站点忽略', () => {
    const merged = applyStorySeed(locById, seed);
    expect(merged.b.timeline[0].label).toBe('兜底条目');
    expect(merged.ghost).toBeUndefined();
  });

  it('没有 seed 时原样返回', () => {
    expect(applyStorySeed(locById, null)).toBe(locById);
  });

  it('合并后能直接算出摘要', () => {
    const merged = applyStorySeed(locById, seed);
    const { timeline, figures, has } = summarizeStory({ stops: ['a', 'b'] }, merged);
    expect(has).toBe(true);
    expect(timeline.map(g => g.era)).toEqual(['东晋', '民国']);
    expect(figures).toHaveLength(1); // 同一人跨地点去重
    expect(figures[0].works).toContain('《乙集》');
  });
});

describe('storySeedFor 内置内容', () => {
  it('庐山有内置案头，覆盖 7 个地点', () => {
    const s = storySeedFor('b47e3d39-212f-44ff-acb4-7aa2b9b7ef6e');
    expect(Object.keys(s.locations)).toHaveLength(7);
    expect(s.locations['b47e3d39-wulao-feng'].figures[0].name).toBe('李白');
  });

  it('没有内置内容的导览返回 null，交给前端走空态', () => {
    expect(storySeedFor('某个不存在的 id')).toBeNull();
    expect(storySeedFor(undefined)).toBeNull();
  });
});
