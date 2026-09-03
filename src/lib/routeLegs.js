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
