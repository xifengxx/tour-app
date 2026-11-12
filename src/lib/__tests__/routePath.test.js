import { describe, expect, it } from 'vitest';
import { sectionPathPoints } from '../routePath';

// 一条向东北延伸的折线：每 0.001 度一个点，模拟高德返回的真实路径采样
const geom = Array.from({ length: 21 }, (_, i) => [110 + i * 0.001, 30 + i * 0.001]);

const locById = {
  a: { id: 'a', lng: 110.0, lat: 30.0 },
  b: { id: 'b', lng: 110.005, lat: 30.005 },
  c: { id: 'c', lng: 110.012, lat: 30.012 },
  d: { id: 'd', lng: 110.020, lat: 30.020 },
};

const route = { stops: ['a', 'b', 'c', 'd'], path: { geom } };

describe('sectionPathPoints', () => {
  it('切出片区内首末站点之间的真实路径片段，不跨片区', () => {
    const pts = sectionPathPoints(route, { stops: ['a', 'b', 'd'] }, locById);
    expect(pts).toBeTruthy();
    expect(pts[0]).toEqual(geom[0]);
    expect(pts[pts.length - 1]).toEqual(geom[20]);
    expect(pts.length).toBe(21);
  });

  it('只覆盖本片区范围时不越界到下一片区', () => {
    const pts = sectionPathPoints(route, { stops: ['a', 'b'] }, locById);
    expect(pts.length).toBeLessThan(geom.length);
    expect(pts[pts.length - 1]).toEqual(geom[5]);
  });

  it('没有路径数据时返回 null，由调用方回退站点直连', () => {
    expect(sectionPathPoints({ stops: ['a', 'b'] }, { stops: ['a', 'b'] }, locById)).toBeNull();
  });

  it('片区内不足两个带坐标的点时返回 null', () => {
    expect(sectionPathPoints(route, { stops: ['a'] }, locById)).toBeNull();
    expect(sectionPathPoints(route, { stops: ['a', 'ghost'] }, locById)).toBeNull();
  });
});
