const MODE_TEXT = {
  walk: '徒步',
  cableway: '索道',
  shuttle: '观光车/摆渡车',
  car: '专车/出租车',
  other: '接驳交通',
};

export function routeLegsText(legs = []) {
  if (!Array.isArray(legs) || legs.length === 0) return '';
  return legs.map((leg) => {
    const mode = MODE_TEXT[leg.mode] || MODE_TEXT.other;
    const detail = [mode, leg.duration, leg.note].filter(Boolean).join('，');
    return `${leg.fromName} → ${leg.toName}：${detail}`;
  }).join('；');
}

// 逐段罗列和卷首语里的「约0.3小时车程」说的是同一件事，读两遍很累。
// 概览里只给按交通方式聚合的总里程（与剖面图例同一口径），逐段信息交给当前站条。
const SUM_LABEL = { walk: '徒步', cableway: '索道', shuttle: '车行', car: '车行', other: '接驳' };
const SUM_ORDER = ['徒步', '车行', '索道', '接驳'];

export function routeLegsSummary(legs = []) {
  if (!Array.isArray(legs) || legs.length === 0) return '';
  const byMode = {};
  let missing = false;
  for (const leg of legs) {
    const m = Number(leg.distanceM);
    if (!Number.isFinite(m) || m <= 0) { missing = true; continue; }
    const key = SUM_LABEL[leg.mode] || SUM_LABEL.other;
    byMode[key] = (byMode[key] || 0) + m;
  }
  // 老数据没有里程就退回逐段文本，不要凭空算一个数出来
  if (missing || Object.keys(byMode).length === 0) return routeLegsText(legs);
  return SUM_ORDER
    .filter(k => byMode[k])
    .map(k => `${k} ${(byMode[k] / 1000).toFixed(1)}km`)
    .join(' · ');
}
