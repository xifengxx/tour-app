import { describe, it, expect } from 'vitest';
import { classifyTour, searchTours, filterByCategory } from '../filterTours';

const tours = [
  { id: 'hs', title: '剑出衡山', subtitle: '跟着赵荣', destination: { name: '南岳衡山', region: '湖南省衡阳市' } },
  { id: 'dh', title: '武汉东湖之旅', subtitle: '', destination: { name: '东湖', region: '湖北武汉' } },
  { id: 'ls', title: '庐山之旅', subtitle: '飞流直下', destination: { name: '庐山', region: '江西九江' } },
  { id: 'sgs', title: '石鼓书院', subtitle: '', destination: { name: '石鼓书院', region: '湖南衡阳' } },
];

describe('classifyTour', () => {
  it('山/峰 → 名山', () => {
    expect(classifyTour(tours[0])).toBe('名山');
    expect(classifyTour(tours[2])).toBe('名山');
  });
  it('湖 → 湖泊', () => {
    expect(classifyTour(tours[1])).toBe('湖泊');
  });
  it('书院 → 人文', () => {
    expect(classifyTour(tours[3])).toBe('人文');
  });
  it('未知 → 其他', () => {
    expect(classifyTour({ destination: { name: '某某广场' } })).toBe('其他');
  });
});

describe('searchTours', () => {
  it('空关键词返回全部', () => {
    expect(searchTours(tours, '')).toHaveLength(4);
    expect(searchTours(tours, '  ')).toHaveLength(4);
  });
  it('匹配标题', () => {
    expect(searchTours(tours, '东湖')).toEqual([tours[1]]);
  });
  it('匹配副标题', () => {
    expect(searchTours(tours, '飞流直下')).toEqual([tours[2]]);
  });
  it('匹配目的地地区', () => {
    expect(searchTours(tours, '衡阳')).toHaveLength(2);
  });
  it('大小写不敏感', () => {
    expect(searchTours([{ ...tours[0], title: 'English Tour' }], 'english')).toHaveLength(1);
  });
});

describe('filterByCategory', () => {
  it('全部/空 → 不过滤', () => {
    expect(filterByCategory(tours, '全部')).toHaveLength(4);
    expect(filterByCategory(tours, null)).toHaveLength(4);
  });
  it('按分类过滤', () => {
    expect(filterByCategory(tours, '名山')).toHaveLength(2);
    expect(filterByCategory(tours, '人文')).toHaveLength(1);
  });
});
