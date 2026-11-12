import { loadAmap } from './amap';

/**
 * 创建导览前的入口校验（A 层）。
 *
 * 背景：管线里所有地点都要过「地区坐标校验」（process-tour 的 regionMatch），
 * 但地区本身是否可信，一直到跑完 60s 才知道。填「四川」这种裸省名，下游会连锁
 * 触发"AI 提议外市景点 → 质心被拉偏 → 半径闸全杀"。这里把这一步提到提交前。
 *
 * 只依赖前端已加载的高德 JS API，不新增服务端能力。
 */

const PROVINCE_RE = /(省|市|自治区|特别行政区|维吾尔|壮族|回族|自治州)/g;

/** 归一化行政区名，用于包含比较："湖南省衡阳市" → "湖南衡阳" */
export function normRegion(value) {
  return String(value || '')
    .replace(/[\s·]/g, '')
    .replace(PROVINCE_RE, '')
    .replace(/^中国/, '');
}

function withTimeout(promise, ms, fallback) {
  return Promise.race([promise, new Promise(res => setTimeout(() => res(fallback), ms))]);
}

function geoOnce(AMap) {
  return new Promise(resolve => {
    try {
      AMap.plugin(['AMap.Geocoder'], () => resolve(new AMap.Geocoder({})));
    } catch {
      resolve(null);
    }
  });
}

/**
 * @returns {Promise<{
 *   ok: boolean,
 *   level: 'fail' | 'warn' | 'pass',
 *   message: string,
 *   canonical?: string,
 *   coord?: { lng: number, lat: number },
 * }>}
 */
export async function checkDestination(destName, destRegion) {
  const name = String(destName || '').trim();
  const region = String(destRegion || '').trim();

  if (!name) return { ok: false, level: 'fail', message: '目的地不能为空' };
  if (!region) return { ok: false, level: 'fail', message: '地区必填：至少写到「省 + 市」，如「湖南省衡阳市」' };

  let AMap;
  try {
    AMap = await loadAmap();
  } catch (e) {
    return { ok: false, level: 'fail', message: `高德地图脚本没加载成功（${e.message}），无法校验目的地` };
  }

  const geocoder = await withTimeout(geoOnce(AMap), 6000, null);
  if (!geocoder) return { ok: false, level: 'fail', message: '高德地理编码插件加载失败，无法校验目的地' };

  // ① 地名 → 坐标（city 用地区做偏置，减少同名地点漂移）
  const hit = await withTimeout(new Promise(resolve => {
    geocoder.getLocation(name, (status, result) => {
      const g = status === 'complete' ? result?.geocodes?.[0] : null;
      resolve(g || null);
    });
  }), 8000, null);

  if (!hit?.location) {
    return { ok: false, level: 'fail', message: `高德查不到「${name}」的坐标，请检查名称，或把地区补到市级后重试` };
  }

  const coord = { lng: Number(hit.location.lng), lat: Number(hit.location.lat) };

  // ② 坐标 → 行政区，判断是否落在填写的地区
  const comp = await withTimeout(new Promise(resolve => {
    geocoder.getAddress([coord.lng, coord.lat], (status, result) => {
      const c = status === 'complete' ? result?.regeocode?.addressComponent : null;
      resolve(c || null);
    });
  }), 8000, null);

  if (!comp) {
    return { ok: false, level: 'fail', message: `「${name}」解析出了坐标，但无法反查行政区，请稍后重试` };
  }

  const province = String(comp.province || '');
  const city = Array.isArray(comp.city) ? '' : String(comp.city || '');
  const district = String(comp.district || '');
  const canonical = `${province}${city || district}`;
  const hay = normRegion(`${province}${city}${district}${comp.township || ''}`);

  const ask = normRegion(region);
  const covered = !!ask && (hay.includes(ask) || ask.includes(hay));
  const cityLevel = !!ask && !!normRegion(city) && ask.includes(normRegion(city));

  if (!covered) {
    return {
      ok: false,
      level: 'fail',
      coord,
      canonical,
      message: `「${name}」的坐标落在 ${canonical || district || province}，与填写的地区「${region}」不符。请改成「${canonical || province}」或更精确的市/县名。`,
    };
  }

  if (!cityLevel) {
    return {
      ok: true,
      level: 'warn',
      coord,
      canonical,
      message: `地区只写到省一级，下游按市级做坐标校验会放得太宽。建议改成「${canonical || district}」。`,
    };
  }

  return { ok: true, level: 'pass', coord, canonical, message: `目的地已核对：${canonical || district}` };
}

/** 目的地类型：决定管线用哪套锚点与分区逻辑（原先硬编码 mountain） */
export const DEST_TYPES = [
  { value: 'mountain', label: '山岳' },
  { value: 'lake', label: '湖泊' },
  { value: 'city', label: '城市' },
  { value: 'heritage', label: '人文古迹' },
  { value: 'town', label: '古镇村落' },
];
