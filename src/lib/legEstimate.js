// 站间「多远 · 走多久」的估算。
//
// 线上问题（2026-11，恒山）：会仙府 → 天峰岭显示"280 米 · 徒步约 4 分钟"，
// 而这一段是爬坡——280 米是两点直线距离，真实步道 560 米、要爬升一百多米，
// 走 4 分钟物理上不可能。两处都要修：
//   1) 距离用路线剖面里的真实里程（path.stopKm 差），直线距离只作兜底；
//   2) 徒步时间按上坡/下坡折算（Naismith 法则），不再用平地配速。

/** 把 "2016米" / "1,990m" / 1990 这类海拔写法解析成米；解析不出返回 null。 */
export const parseElevM = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').replace(/[,，]/g, '');
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && Math.abs(n) < 9000 ? n : null;
};

/**
 * 某一段路线上的累计爬升/下降。剖面点是 {km, m}，km 是沿线真实里程。
 * 只统计落在 [kmA, kmB] 内的点（含端点插值不做，段内点足够密）。
 */
export const ascentBetweenProf = (prof, kmA, kmB) => {
  if (!Array.isArray(prof) || prof.length < 2) return { ascent: 0, descent: 0 };
  const lo = Math.min(kmA, kmB);
  const hi = Math.max(kmA, kmB);
  // 剖面有两种形态：管线写库的 {km, m}，前端 hook 归一化后的 [km, m] 数组对。
  const pts = prof
    .map(p => (Array.isArray(p)
      ? { km: Number(p[0]), m: parseElevM(p[1]) }
      : { km: Number(p?.km), m: parseElevM(p?.m) }))
    .filter(p => Number.isFinite(p.km) && p.m != null);
  if (pts.length < 2) return { ascent: 0, descent: 0 };
  let ascent = 0;
  let descent = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // 只统计整段都落在区间内的采样，避免把区间外的爬升算进这一段
    if (a.km < lo || b.km > hi) continue;
    const d = b.m - a.m;
    // 单段 >80m 的跳变多半是采样噪声或跨区拼接，不计入
    if (Math.abs(d) > 80) continue;
    if (d > 0) ascent += d;
    else descent -= d;
  }
  return { ascent: Math.round(ascent), descent: Math.round(descent) };
};

/** 平面配速（km/h）→ 时间（分钟）。仅用于没有剖面/没有海拔的兜底。 */
export const flatMinutes = (meters, speedKmh = 4.5) => {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.max(1, Math.round((meters / 1000) / speedKmh * 60));
};

/**
 * 徒步时间（Naismith 法则）：平地 4.5km/h，每上升 100m 加 10 分钟，
 * 每下降 100m 加 4 分钟。山地游客的配速比越野跑保守，这样才不会把
 * "560 米 + 爬升 130 米"算成 4 分钟。
 */
export const walkMinutes = (meters, ascent = 0, descent = 0) => {
  if (!Number.isFinite(meters) || meters <= 0) return null;
  const base = (meters / 1000) / 4.5 * 60;
  const up = Math.max(0, ascent) / 100 * 10;
  const down = Math.max(0, descent) / 100 * 4;
  return Math.max(2, Math.round(base + up + down));
};

/**
 * 取第 idx 站到第 idx+1 站的距离（米）：
 * 真实路径里程差（path.stopKm）> leg.distanceM（多为直线）> 两点直连。
 */
export const legDistanceM = (route, idx, straightM = null) => {
  const stopKm = route?.path?.stopKm;
  if (Array.isArray(stopKm) && Number.isFinite(stopKm[idx]) && Number.isFinite(stopKm[idx + 1])) {
    const d = (stopKm[idx + 1] - stopKm[idx]) * 1000;
    if (d > 0) return Math.round(d);
  }
  if (Number.isFinite(straightM) && straightM > 0) return Math.round(straightM);
  return null;
};
