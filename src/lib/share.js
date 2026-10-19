/**
 * 分享相关纯逻辑（可测试）。
 */

/**
 * 构建导览分享 URL。
 * 导览 id 形状不统一：DB 导览有顶层 id(UUID)，静态导览 id 在 meta.tourId（无顶层 id）。
 * 必须优先用路由参数 tourId，否则静态导览会拼出 `/tour/undefined`。
 * @param {string} origin 站点源
 * @param {string|undefined} tourId 路由参数
 * @param {object} [tour] 导览对象（兜底读取 meta.tourId / id）
 */
export function buildShareUrl(origin, tourId, tour, routeId) {
  const id = tourId || tour?.meta?.tourId || tour?.id;
  // v99：分享可直达某条路线（借鉴 trail-planet 的 #路线id 深链），
  // TourView 挂载时解析 #r= 并选中对应路线。
  return `${origin}/tour/${id}${routeId ? `#r=${encodeURIComponent(routeId)}` : ''}`;
}
