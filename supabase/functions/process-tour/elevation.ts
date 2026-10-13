// v86a: OpenTopoData（免费、无 key、JSON 响应，单次 ≤100 点）。
// etopo1 全球覆盖（分辨率约 1.8 km），对路线剖面足够。
// 失败静默返回 null——海拔是增强信息，不能因它阻断导览生成。

const OTD_URL = "https://api.opentopodata.org/v1/etopo1";
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

async function fetchElevations(points: { lng: number; lat: number }[]): Promise<number[]> {
  const locations = points.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join("|");
  const res = await fetch(`${OTD_URL}?locations=${encodeURIComponent(locations)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "OK") throw new Error(`OpenTopoData: ${data.status}`);
  return (data.results || []).map((r: any) => Math.round(Number(r.elevation) || 0));
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
    const results = await Promise.all(chunks.map(fetchElevations));
    const elevations = results.flat();
    if (elevations.length !== interpolated.length) return null;
    return interpolated.map((p, i) => ({ km: p.km, m: elevations[i] }));
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
