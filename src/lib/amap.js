const AMAP_KEY = import.meta.env.VITE_AMAP_KEY || '858c05dea3990ef1b900bfd298ebefa7';
const AMAP_SECURITY_CODE = import.meta.env.VITE_AMAP_SECURITY_CODE || 'f98c91fa4c7219afe557be4f0786f594';

let amapPromise;

export function loadAmap() {
  if (typeof window !== 'undefined' && window.AMap) return Promise.resolve(window.AMap);
  if (amapPromise) return amapPromise;

  amapPromise = new Promise((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      amapPromise = undefined;
      reject(new Error('高德地图加载超时，请检查网络后重试。'));
    }, 10000);
    const succeed = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(window.AMap);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      amapPromise = undefined;
      reject(new Error('高德地图脚本加载失败，请检查网络后重试。'));
    };
    const existing = document.querySelector('script[data-amap-loader]');
    if (existing) {
      existing.addEventListener('load', succeed, { once: true });
      existing.addEventListener('error', fail, { once: true });
      return;
    }

    window._AMapSecurityConfig = { securityJsCode: AMAP_SECURITY_CODE };
    const script = document.createElement('script');
    script.dataset.amapLoader = 'true';
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${AMAP_KEY}&plugin=AMap.Polyline,AMap.Scale`;
    script.async = true;
    script.onload = succeed;
    script.onerror = fail;
    document.head.appendChild(script);
  });

  return amapPromise;
}
