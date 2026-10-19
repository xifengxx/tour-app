import { describe, expect, it } from 'vitest';
import { normalizeTour } from '../useTourData';

describe('normalizeTour 透传真实路径（v99.7 回归）', () => {
  it('routes.path 必须原样带到前端对象，坏数据退回 null', () => {
    const row = {
      id: 't1', routes: [
        { id: 'r1', day_label: '1日精华游', title: 'x', stops: [], legs: [], sections: [], prof: [{ km: 0, m: 100 }], path: { geom: [[1, 2], [3, 4]], stopKm: [0, 1], totalKm: 1, planned: 1, fellBack: 0 } },
        { id: 'r2', day_label: '主题游', title: 'y', stops: [], legs: [], sections: [], prof: [], path: { geom: [] } },
      ],
      locations: [], content_layers: [], tips: [],
    };
    const t = normalizeTour(row);
    expect(t.routes[0].path.geom).toEqual([[1, 2], [3, 4]]);
    expect(t.routes[1].path).toBe(null);
    expect(t.routes[0].prof).toEqual([[0, 100]]);
  });
});
