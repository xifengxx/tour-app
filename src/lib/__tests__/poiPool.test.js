import { describe, it, expect } from 'vitest';
import { cleanPoiName, isTourSite, sameSite, buildPool, poolPromptLines } from '../poiPool';

describe('poiPool 候选池清洗', () => {
  it('剥掉景区前缀与括号注释，得到可比对的核心名', () => {
    expect(cleanPoiName('庐山国家级旅游风景名胜区-仙人洞')).toBe('仙人洞');
    expect(cleanPoiName('庐山国家重点风景名胜区-三宝树')).toBe('三宝树');
    expect(cleanPoiName('三叠泉（瀑布）')).toBe('三叠泉');
    expect(cleanPoiName('秀峰风景区-第一山')).toBe('第一山');
  });

  it('设施、展厅、商铺、植物目录不进池', () => {
    expect(isTourSite({ name: '植物园站' })).toBe(false);
    expect(isTourSite({ name: '东线卡口站' })).toBe(false);
    expect(isTourSite({ name: '庐山抗战博物馆-第一展厅' })).toBe(false);
    expect(isTourSite({ name: '黄龙寺法物流通处' })).toBe(false);
    expect(isTourSite({ name: '大天池站(-纪念品店)' })).toBe(false);
    expect(isTourSite({ name: '杜鹃分类区' })).toBe(false);
    expect(isTourSite({ name: '中国科学院庐山植物园-铝合金温室' })).toBe(false);
    expect(isTourSite({ name: '庐山荣誉香山苑酒店牯岭街店' })).toBe(false);
  });

  it('真实游览点保留', () => {
    expect(isTourSite({ name: '仙人洞' })).toBe(true);
    expect(isTourSite({ name: '三叠泉' })).toBe(true);
    expect(isTourSite({ name: '东林寺' })).toBe(true);
    expect(isTourSite({ name: '白鹿洞书院' })).toBe(true);
  });

  it('同一点位的不同叫法判为同一处', () => {
    expect(sameSite('仙人洞', '庐山国家级旅游风景名胜区-仙人洞')).toBe(true);
    expect(sameSite('三叠泉', '三叠泉景区')).toBe(true);
    expect(sameSite('五老峰', '三叠泉')).toBe(false);
  });

  it('buildPool 按评分与国家级排序，150m 内去重，低分非国家级丢弃', () => {
    const cands = [
      { name: '仙人洞', lat: 29.52, lng: 115.97, rating: 4.6, typecode: '110202' },
      { name: '庐山国家级旅游风景名胜区-仙人洞', lat: 29.5201, lng: 115.9701, rating: 4.3, typecode: '110203' },
      { name: '某农家菜馆', lat: 29.53, lng: 115.98, rating: 4.9, typecode: '110000' },
      { name: '冷门小庙', lat: 29.54, lng: 115.99, rating: 3.1, typecode: '110203' },
      { name: '三叠泉', lat: 29.55, lng: 116.0, rating: 4.4, typecode: '110202' },
    ];
    const { pool, dropped } = buildPool(cands, { destName: '庐山', minRating: 3.5 });
    expect(dropped.nonSite).toBe(1); // 农家菜馆
    expect(dropped.dup).toBe(1); // 同名仙人洞合并
    expect(dropped.lowRating).toBe(1); // 3.1 分的非国家级
    expect(pool.map(p => p.clean)).toEqual(['仙人洞', '三叠泉']);
    expect(pool[0].score).toBeGreaterThan(pool[1].score);
  });

  it('没有评分的国家级景点不被低分规则误杀', () => {
    const { pool } = buildPool([{ name: '老牌景区', lat: 29.5, lng: 115.9, rating: 0, typecode: '110202' }], { minRating: 3.5 });
    expect(pool).toHaveLength(1);
  });

  it('候选池文本按顺序编号，供 AI 只能从池里挑', () => {
    const lines = poolPromptLines([
      { clean: '仙人洞', rating: 4.6 },
      { clean: '三叠泉', rating: 4.4 },
    ]);
    expect(lines).toBe('1. 仙人洞（4.6★）\n2. 三叠泉（4.4★）');
  });
});
