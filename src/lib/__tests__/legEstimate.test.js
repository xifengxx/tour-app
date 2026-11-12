import { describe, it, expect } from 'vitest';
import { ascentBetweenProf, legDistanceM, parseElevM, walkMinutes } from '../legEstimate';

describe('parseElevM', () => {
  it('解析中文海拔写法', () => {
    expect(parseElevM('2016米')).toBe(2016);
    expect(parseElevM('1,990 m')).toBe(1990);
    expect(parseElevM(1600)).toBe(1600);
    expect(parseElevM('')).toBeNull();
    expect(parseElevM(undefined)).toBeNull();
  });
});

describe('ascentBetweenProf', () => {
  const prof = [
    { km: 0, m: 1500 },
    { km: 0.2, m: 1560 },
    { km: 0.4, m: 1540 },
    { km: 0.6, m: 1620 },
    { km: 0.8, m: 1700 },
  ];
  it('只统计区间内的正增量', () => {
    expect(ascentBetweenProf(prof, 0.2, 0.6)).toEqual({ ascent: 80, descent: 20 });
  });
  it('无剖面时返回 0', () => {
    expect(ascentBetweenProf(null, 0, 1)).toEqual({ ascent: 0, descent: 0 });
  });
  it('支持前端归一化后的 [km, m] 数组对', () => {
    expect(ascentBetweenProf([[0, 1500], [0.2, 1560], [0.4, 1540], [0.6, 1620]], 0.2, 0.6))
      .toEqual({ ascent: 80, descent: 20 });
  });
});

describe('walkMinutes', () => {
  it('平地 560 米约 7 分钟', () => {
    expect(walkMinutes(560, 0, 0)).toBe(7);
  });
  it('560 米 + 爬升 130 米 不再是 4 分钟（恒山会仙府→天峰岭实测）', () => {
    expect(walkMinutes(560, 130, 0)).toBe(20);
  });
  it('下降也略慢于平地', () => {
    expect(walkMinutes(560, 0, 130)).toBeGreaterThan(walkMinutes(560, 0, 0));
  });
});

describe('legDistanceM', () => {
  it('真实路径里程优先于直线距离', () => {
    const route = { path: { stopKm: [0, 0.14, 3.35, 3.76] } };
    expect(legDistanceM(route, 2, 280)).toBe(410);
  });
  it('没有 path 时退回直线距离', () => {
    expect(legDistanceM({}, 0, 280)).toBe(280);
  });
});
