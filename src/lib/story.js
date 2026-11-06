/**
 * P1-5 案头的聚合逻辑：把路线各站的 timeline / figures 合并成
 * 一条按时期分段的时间轴 + 去重后的人物表。
 *
 *   timeline[i] = { era, label, function, change, evidence, order? }
 *   figures[i]  = { name, role, relation, works[], evidence }
 */

const eraOrder = (item, fallback) => (Number.isFinite(item?.order) ? item.order : fallback);

export function collectTimeline(route, locById) {
  const groups = new Map();
  let seq = 0;
  for (const id of route?.stops || []) {
    const loc = locById?.[id];
    const items = Array.isArray(loc?.timeline) ? loc.timeline : [];
    items.forEach((it, i) => {
      if (!it || !it.label) return;
      const era = String(it.era || '未分期').trim();
      const order = eraOrder(it, seq + i);
      if (!groups.has(era)) groups.set(era, { era, order, items: [] });
      const g = groups.get(era);
      g.order = Math.min(g.order, order);
      g.items.push({ ...it, locationName: loc.name, locationId: id });
    });
    seq += 10; // 同 era 内按路线顺序排
  }
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

export function collectFigures(route, locById) {
  const seen = new Map();
  for (const id of route?.stops || []) {
    const loc = locById?.[id];
    const items = Array.isArray(loc?.figures) ? loc.figures : [];
    items.forEach(f => {
      if (!f || !f.name) return;
      const key = String(f.name);
      if (!seen.has(key)) {
        seen.set(key, { name: key, role: f.role || '', relation: f.relation || '', works: [], evidence: f.evidence || '', places: [] });
      }
      const rec = seen.get(key);
      if (f.role && !rec.role) rec.role = f.role;
      if (f.relation && !rec.relation) rec.relation = f.relation;
      if (f.evidence && !rec.evidence) rec.evidence = f.evidence;
      (Array.isArray(f.works) ? f.works : []).forEach(w => { if (w && !rec.works.includes(w)) rec.works.push(w); });
      if (loc?.name && !rec.places.includes(loc.name)) rec.places.push(loc.name);
    });
  }
  return [...seen.values()];
}

/** 概览入口行要知道"几段 / 几个人"，以及这条线有没有案头 */
export function summarizeStory(route, locById) {
  const timeline = collectTimeline(route, locById);
  const figures = collectFigures(route, locById);
  return { timeline, figures, has: timeline.length > 0 || figures.length > 0 };
}

/**
 * 把仓库里的案头内容并入地点表：库里已有值优先，缺的用 JSON 兜底。
 * 这样数据库还没加 timeline/figures 列时，页面也能完整呈现（而不是一屏空态）。
 */
export function applyStorySeed(locById, seed) {
  if (!seed?.locations) return locById;
  const out = { ...locById };
  for (const [id, extra] of Object.entries(seed.locations)) {
    const loc = out[id];
    if (!loc) continue;
    const timeline = loc.timeline?.length ? loc.timeline : (Array.isArray(extra.timeline) ? extra.timeline : []);
    const figures = loc.figures?.length ? loc.figures : (Array.isArray(extra.figures) ? extra.figures : []);
    out[id] = { ...loc, timeline, figures };
  }
  return out;
} 


