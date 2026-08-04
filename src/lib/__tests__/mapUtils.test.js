import { describe, it, expect } from 'vitest';
import { extractMarkerLoc, findNearestLocation, buildPinIcon } from '../mapUtils';

const locations = [
  { id: 'a', name: '甲峰', lng: 118.0, lat: 28.0 },
  { id: 'b', name: '乙峰', lng: 119.0, lat: 29.0 },
];
const pos = (lng, lat) => ({ getLng: () => lng, getLat: () => lat });

describe('extractMarkerLoc', () => {
  it('从 [point] 数组提取地点（回归：AMap 2.0 ctx.data 数组 bug）', () => {
    const loc = { id: 'a', name: '甲峰', lng: 118.0, lat: 28.0 };
    const ctxData = [{ lnglat: [118, 28], extData: loc }];
    expect(extractMarkerLoc(ctxData, locations, () => pos(118, 28))).toEqual(loc);
  });

  it('从 { extData } 对象提取', () => {
    const loc = { id: 'b', name: '乙峰', lng: 119, lat: 29 };
    expect(extractMarkerLoc({ extData: loc }, locations, () => pos(119, 29))).toEqual(loc);
  });

  it('ctx.data 缺失时按坐标兜底匹配', () => {
    expect(extractMarkerLoc(undefined, locations, () => pos(118, 28))).toEqual(locations[0]);
  });

  it('坐标匹配不到 → 返回 {}（不抛错）', () => {
    expect(extractMarkerLoc(undefined, locations, () => pos(0, 0))).toEqual({});
  });
});

describe('findNearestLocation', () => {
  it('返回距 pos 最近的地点', () => {
    expect(findNearestLocation(locations, pos(118.1, 28.1))).toEqual(locations[0]);
  });

  it('空数组 → undefined', () => {
    expect(findNearestLocation([], pos(0, 0))).toBeUndefined();
  });
});

describe('buildPinIcon', () => {
  it('生成 SVG data-URI，selected 含白色描边', () => {
    const icon = buildPinIcon('#c96442', 26, true);
    expect(icon.startsWith('data:image/svg+xml,')).toBe(true);
    expect(icon).toContain('c96442');
    expect(icon).toContain('stroke');
  });

  it('未选中无描边、用未选中色', () => {
    const icon = buildPinIcon('#b3ae9e', 26, false);
    expect(icon).toContain('b3ae9e');
    expect(icon).not.toContain('fill="none"');
  });
});
