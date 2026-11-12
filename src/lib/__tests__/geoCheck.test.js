import { describe, it, expect, vi } from 'vitest';
import { checkDestination, normRegion } from '../geoCheck';

// 假高德：只实现 Geocoder 的两个方法
function mockAmap({ province = '湖南省', city = '衡阳市', district = '南岳区', noCoord = false, noComp = false } = {}) {
  return {
    plugin: (_plugins, cb) => cb(),
    Geocoder: function Geocoder() {
      return {
        getLocation: (_addr, cb) => cb('complete', noCoord ? { geocodes: [] } : { geocodes: [{ location: { lng: '112.6', lat: '27.3' } }] }),
        getAddress: (_loc, cb) => cb('complete', noComp ? {} : { regeocode: { addressComponent: { province, city, district } } }),
      };
    },
  };
}

const loadMock = vi.fn();
vi.mock('../amap', () => ({ loadAmap: (...args) => loadMock(...args) }));

describe('geoCheck 目的地校验', () => {
  it('省名归一：去掉省/市/自治区后缀', () => {
    expect(normRegion('湖南省衡阳市')).toBe('湖南衡阳');
    expect(normRegion('广西壮族自治区桂林市')).toBe('广西桂林');
    expect(normRegion(' 北京市 · 海淀区 ')).toBe('北京海淀区');
  });

  it('地区填到市且坐标吻合 → pass', async () => {
    loadMock.mockResolvedValue(mockAmap());
    const r = await checkDestination('南岳衡山', '湖南省衡阳市');
    expect(r.ok).toBe(true);
    expect(r.level).toBe('pass');
    expect(r.canonical).toBe('湖南省衡阳市');
  });

  it('坐标落在别的省 → fail，并给出实际位置', async () => {
    loadMock.mockResolvedValue(mockAmap({ province: '四川省', city: '成都市', district: '都江堰市' }));
    const r = await checkDestination('青城山', '湖南省衡阳市');
    expect(r.ok).toBe(false);
    expect(r.level).toBe('fail');
    expect(r.message).toContain('四川省成都市');
  });

  it('地区只写到省 → warn，允许继续但提示改到市', async () => {
    loadMock.mockResolvedValue(mockAmap());
    const r = await checkDestination('南岳衡山', '湖南省');
    expect(r.ok).toBe(true);
    expect(r.level).toBe('warn');
    expect(r.message).toContain('湖南省衡阳市');
  });

  it('地区为空 → fail（下游按地区做坐标校验，空地区会放太宽）', async () => {
    loadMock.mockResolvedValue(mockAmap());
    const r = await checkDestination('南岳衡山', '');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('地区必填');
  });

  it('高德查不到坐标 → fail，不往下猜', async () => {
    loadMock.mockResolvedValue(mockAmap({ noCoord: true }));
    const r = await checkDestination('不存在的地方', '湖南省衡阳市');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('查不到');
  });

  it('坐标反查失败 → fail', async () => {
    loadMock.mockResolvedValue(mockAmap({ noComp: true }));
    const r = await checkDestination('南岳衡山', '湖南省衡阳市');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('无法反查');
  });
});
