// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { loadAmap } from '../amap';

describe('loadAmap', () => {
  beforeEach(() => {
    document.head.querySelectorAll('script[data-amap-loader]').forEach(script => script.remove());
    delete window.AMap;
  });

  it('已有 SDK 时直接复用', async () => {
    window.AMap = { Map: class {} };
    await expect(loadAmap()).resolves.toBe(window.AMap);
  });

  it('脚本加载失败时返回可读错误', async () => {
    const promise = loadAmap();
    const script = document.querySelector('script[data-amap-loader]');
    script.dispatchEvent(new Event('error'));
    await expect(promise).rejects.toThrow('高德地图脚本加载失败');
  });
});
