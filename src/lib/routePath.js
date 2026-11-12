/**
 * 主题游片区分段路径（v100）。
 *
 * 之前片区内的线是"站点直连"——在高德地图上就是几条穿过山体的直线，
 * 恒山那片看起来像架了个三角形。routes.path.geom 里已经有整条路线的高德真实路径
 * （步行/车行都按实际道路采样），只要按"片区内首末站点"把它切出来即可，
 * 不必另调路径规划，也不必额外落库。
 */
const toRad = d => (d * Math.PI) / 180;
function haversineM(a, b) {
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** geom 上离某个坐标最近的点下标（geom 只有几百个点，全扫可接受） */
function nearestIndex(geom, lng, lat) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    const d = haversineM([lng, lat], p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * 取一个片区对应的真实路径片段；拿不到就返回 null，交给调用方回退到站点直连。
 * @returns {Array<[number, number]>|null}
 */
export function sectionPathPoints(route, section, locById) {
  const geom = route?.path?.geom;
  const routeStops = route?.stops || [];
  const ids = (section?.stops || []).filter(id => routeStops.includes(id));
  if (!Array.isArray(geom) || geom.length < 2 || ids.length < 2) return null;

  const idx = ids
    .map((id) => {
      const l = locById?.[id];
      if (!l || !Number.isFinite(l.lng) || !Number.isFinite(l.lat)) return -1;
      return nearestIndex(geom, l.lng, l.lat);
    })
    .filter(i => i >= 0)
    .sort((a, b) => a - b);

  if (idx.length < 2) return null;
  const from = idx[0];
  const to = idx[idx.length - 1];
  if (to - from < 2) return null;
  return geom.slice(from, to + 1);
}
