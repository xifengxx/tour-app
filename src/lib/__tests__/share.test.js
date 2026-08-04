import { describe, it, expect } from 'vitest';
import { buildShareUrl } from '../share';

describe('buildShareUrl', () => {
  const ORIGIN = 'https://tour-app-pro.vercel.app';

  it('DB 导览（顶层 id=UUID）：优先用路由参数', () => {
    const tour = { id: '550e8400-e29b-41d4-a716-446655440000' };
    expect(buildShareUrl(ORIGIN, '550e8400-e29b-41d4-a716-446655440000', tour))
      .toBe(`${ORIGIN}/tour/550e8400-e29b-41d4-a716-446655440000`);
  });

  it('静态导览（id 在 meta.tourId，无顶层 id）：不再拼出 /tour/undefined（回归）', () => {
    const tour = { meta: { tourId: 'nanyue-hengshan', title: '剑出衡山' } };
    expect(buildShareUrl(ORIGIN, 'nanyue-hengshan', tour))
      .toBe(`${ORIGIN}/tour/nanyue-hengshan`);
  });

  it('无路由参数时兜底 meta.tourId', () => {
    const tour = { meta: { tourId: 'huashan-xiaoao' } };
    expect(buildShareUrl(ORIGIN, undefined, tour)).toBe(`${ORIGIN}/tour/huashan-xiaoao`);
  });

  it('无路由参数与 meta 时兜底 tour.id', () => {
    const tour = { id: 'abc123' };
    expect(buildShareUrl(ORIGIN, undefined, tour)).toBe(`${ORIGIN}/tour/abc123`);
  });

  it('三处 id 全缺失 → 拼出 /tour/undefined（已知边界，调用方应避免）', () => {
    expect(buildShareUrl(ORIGIN, undefined, {})).toBe(`${ORIGIN}/tour/undefined`);
  });
});
