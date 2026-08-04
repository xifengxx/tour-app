/**
 * 地图标记相关纯逻辑（可测试，无 AMap 依赖）。
 * 从 TourView 抽出：ctx.data 提取、聚合最近点、图钉 SVG。
 */

/**
 * 从 AMap 2.0 MarkerCluster 的 ctx.data 提取地点。
 * ctx.data 是 [point] 数组（point = { lnglat, extData }），不是点对象——
 * 直接读 ctx.data.extData 会落空成数组（曾导致标记全灰 + 点击选中空对象）。
 * loc.name 缺失时按坐标匹配 locations 兜底。
 * @param {*} ctxData renderMarker 回调的 ctx.data
 * @param {Array} locations 导览全部地点
 * @param {Function} getPosition 返回 { getLng(), getLat() } 的位置对象
 */
export function extractMarkerLoc(ctxData, locations, getPosition) {
  const raw = Array.isArray(ctxData) ? ctxData[0] : ctxData;
  let loc = (raw && (raw.extData || raw.data)) || raw || {};
  if (!loc.name) {
    const p = getPosition();
    loc = locations.find(l => Math.abs(l.lng - p.getLng()) < 1e-4 && Math.abs(l.lat - p.getLat()) < 1e-4) || {};
  }
  return loc;
}

/**
 * 聚合气泡点击：找距 pos 最近的地点（平方距离比较，免开方）。
 * @returns {object|undefined}
 */
export function findNearestLocation(locations, pos) {
  return locations.reduce((best, l) => {
    const d = (l.lng - pos.getLng()) ** 2 + (l.lat - pos.getLat()) ** 2;
    return !best || d < best.d ? { l, d } : best;
  }, null)?.l;
}

/** 图钉 SVG data-URI。selected 时加白色描边放大。 */
export function buildPinIcon(color, size, selected) {
  return 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size + 10}" viewBox="0 0 ${size} ${size + 10}">` +
    `<filter id="s"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-opacity="0.4"/></filter>` +
    (selected
      ? `<path d="M${size / 2} 0 C${size * 0.23} 0 0 ${size * 0.23} 0 ${size / 2} C0 ${size * 0.77} ${size / 2} ${size + 6} ${size / 2} ${size + 6}z" fill="none" stroke="#fff" stroke-width="3" opacity="0.95"/>`
      : '') +
    `<path d="M${size / 2} 0 C${size * 0.23} 0 0 ${size * 0.23} 0 ${size / 2} C0 ${size * 0.77} ${size / 2} ${size + 6} ${size / 2} ${size + 6}z" fill="${color}" filter="url(#s)"/>` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.22}" fill="#fff" opacity="0.9"/>` +
    `</svg>`
  );
}
