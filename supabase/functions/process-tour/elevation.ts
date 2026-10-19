// v86a: OpenTopoData（免费、无 key、JSON 响应，单次 ≤100 点）。
// v99：主源换 srtm30m（约 30m 网格）——借鉴 map-motion 的海拔工艺。
// etopo1 的 1.8km 网格会把"2900m→4506m 爬升 5km"的雪山剖面抹成近似直线，
// 累计爬升严重失真（玉龙雪山实测）；SRTM 覆盖中国全部国土。
// srtm30m 失败（限流/无覆盖）时回退 etopo1；全失败静默返回 null——
// 海拔是增强信息，不能因它阻断导览生成。

const OTD_BASE = "https://api.opentopodata.org/v1";
const OTD_DATASETS = ["srtm30m", "etopo1"];
const MAX_POINTS = 100;

export type ElevationPoint = { km: number; m: number };

function havKm(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// 沿站点折线均匀插值 targetSamples 个点，返回带累计里程的坐标序列。
export function interpolateStops(
  stops: { lng: number; lat: number }[],
  targetSamples: number,
): { lng: number; lat: number; km: number }[] {
  if (stops.length < 2) {
    return stops.map((s) => ({ ...s, km: 0 }));
  }
  const cum: number[] = [0];
  for (let i = 1; i < stops.length; i++) {
    cum.push(cum[i - 1] + havKm(stops[i - 1], stops[i]));
  }
  const totalKm = cum[cum.length - 1];
  if (totalKm < 0.001) return stops.map((s) => ({ ...s, km: 0 }));

  const n = Math.max(2, Math.min(targetSamples, MAX_POINTS));
  const points: { lng: number; lat: number; km: number }[] = [];
  const step = totalKm / (n - 1);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(step * i, totalKm);
    while (seg < cum.length - 2 && cum[seg + 1] < d) seg++;
    const segLen = Math.max(cum[seg + 1] - cum[seg], 0.0001);
    const t = Math.min(1, Math.max(0, (d - cum[seg]) / segLen));
    points.push({
      lng: stops[seg].lng + (stops[seg + 1].lng - stops[seg].lng) * t,
      lat: stops[seg].lat + (stops[seg + 1].lat - stops[seg].lat) * t,
      km: Math.round(d * 100) / 100,
    });
  }
  // 确保终点精确。
  if (points.length && points[points.length - 1].km < totalKm) {
    points.push({ ...stops[stops.length - 1], km: Math.round(totalKm * 100) / 100 });
  }
  return points;
}

const PI = Math.PI;
const DATUM_A = 6378245.0;
const DATUM_EE = 0.00669342162296594;
const tfLat = (x: number, y: number) => -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
const tfLng = (x: number, y: number) => 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
/**
 * GCJ-02（高德坐标）→ WGS-84（GPS/DEM 坐标）。
 * OpenTopoData/AWS 高程网格按 WGS-84 索引；中国境内 GCJ 偏移约 100-700m，
 * 在 30m 分辨率 + 陡坡地形上会把海拔读错几十到上百米。
 * （借鉴 map-motion 的坐标纪律："全程 GCJ-02，查海拔时转回 WGS-84"。）
 */
export function gcj02ToWgs84(lng: number, lat: number): [number, number] {
  if (!(lng > 72.004 && lng < 137.8347 && lat > 0.8293 && lat < 55.8271)) return [lng, lat];
  let dLat = tfLat(lng - 105, lat - 35);
  let dLng = tfLng(lng - 105, lat - 35);
  const radLat = (lat / 180) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - DATUM_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / (((DATUM_A * (1 - DATUM_EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180) / ((DATUM_A / sqrtMagic) * Math.cos(radLat) * PI);
  return [lng - dLng, lat - dLat];
}

async function fetchElevations(points: { lng: number; lat: number }[], dataset: string): Promise<number[]> {
  const locations = points.map((p) => {
    const [wLng, wLat] = gcj02ToWgs84(p.lng, p.lat);
    return `${wLat.toFixed(5)},${wLng.toFixed(5)}`;
  }).join("|");
  // v99.8：OpenTopoData 免费额度约 1 req/s，批量重跑必撞 429
  // （玉龙雪山 1日线剖面实测被限流吞掉：两档数据源各失败一次 → prof 空 →
  // 前端没有海拔剖面图）。429 单独退避重试，不消耗数据集回退链的机会。
  let lastErr = "OpenTopoData 未知失败";
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(`${OTD_BASE}/${dataset}?locations=${encodeURIComponent(locations)}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        lastErr = `OpenTopoData[${dataset}] HTTP 429（限流）`;
        await new Promise((s) => setTimeout(s, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`OpenTopoData[${dataset}] HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== "OK") throw new Error(`OpenTopoData: ${data.status}`);
      return (data.results || []).map((r: any) => Math.round(Number(r.elevation) || 0));
    } catch (e: any) {
      lastErr = e?.message || String(e);
      if (!/429|限流/.test(lastErr)) throw e;
    }
  }
  throw new Error(lastErr);
}

// 主入口：给定路线站点坐标，返回海拔剖面；失败返回 null。
export async function elevationProfile(
  stops: { lng: number; lat: number }[],
  samples = 80,
): Promise<ElevationPoint[] | null> {
  if (!stops || stops.length < 2) return null;
  const valid = stops.filter((s) => Number.isFinite(s.lng) && Number.isFinite(s.lat));
  if (valid.length < 2) return null;
  try {
    const interpolated = interpolateStops(valid, samples);
    // OpenTopoData 单次最多 100 点；80 默认值一次搞定，超过时分批。
    const chunks: (typeof interpolated)[] = [];
    for (let i = 0; i < interpolated.length; i += MAX_POINTS) {
      chunks.push(interpolated.slice(i, i + MAX_POINTS));
    }
    for (const dataset of OTD_DATASETS) {
      try {
        const results = await Promise.all(chunks.map((c) => fetchElevations(c, dataset)));
        const elevations = results.flat();
        if (elevations.length !== interpolated.length) throw new Error("结果数量不匹配");
        if (dataset !== OTD_DATASETS[0]) console.warn(`elevationProfile 回退到 ${dataset}`);
        return interpolated.map((p, i) => ({ km: p.km, m: elevations[i] }));
      } catch (e: any) {
        console.warn(`elevationProfile[${dataset}] failed: ${e?.message || e}`);
      }
    }
    return null;
  } catch (e: any) {
    console.warn(`elevationProfile failed: ${e?.message || e}`);
    return null;
  }
}

// 累计爬升（米）：只累加正高差。
export function elevationGain(profile: ElevationPoint[]): number {
  let gain = 0;
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i].m - profile[i - 1].m;
    if (d > 0) gain += d;
  }
  return Math.round(gain);
}
