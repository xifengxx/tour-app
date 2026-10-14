/**
 * 主题游分区的编辑逻辑（纯函数，可测试）。
 *
 * 数据形状（与 routes.sections 列一致，UI 里 stops 即落库的 stopIds）：
 *   { key, name, kind: "核心景区"|"周边景点", stops: string[], text: string }
 *
 * 不变量：分区引用的站点必须都在 route.stops 里。
 * route.stops 仍是扁平序列，所以地图连线、海拔剖面、交通分段都照常工作，
 * 分区只是叠在上面的一层分组视图。
 */

export const UNGROUPED = null;

const cleanIds = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];

/** 把任意来源的 sections 规整成安全形状，并剔除已不存在的站点。 */
export function normalizeSections(raw, stops = []) {
  const valid = new Set(stops);
  const usedKeys = new Set();
  // 重复 key 必须改名而不是丢弃：片区靠 key 定位，
  // 两个片区撞 key 会让编辑器把第二个站点的归属改到第一个片区上。
  const uniqueKey = (base, i) => {
    let key = base || `sec-${i + 1}`;
    for (let n = 2; usedKeys.has(key); n += 1) key = `${base}-${n}`;
    usedKeys.add(key);
    return key;
  };
  return (Array.isArray(raw) ? raw : []).map((sec, i) => {
    const key = uniqueKey(String(sec?.key || sec?.name || `sec-${i + 1}`), i);
    return {
      key,
      name: String(sec?.name || '未命名片区'),
      kind: sec?.kind === '核心景区' ? '核心景区' : '周边景点',
      stops: cleanIds(sec?.stops ?? sec?.stopIds).filter((id) => !valid.size || valid.has(id)),
      text: typeof sec?.text === 'string' ? sec.text : '',
    };
  });
}

export function sectionsForDb(sections) {
  return (Array.isArray(sections) ? sections : []).map(sec => ({
    key: sec.key, name: sec.name, kind: sec.kind === '核心景区' ? '核心景区' : '周边景点',
    stopIds: cleanIds(sec.stops), text: sec.text || '',
  }));
}

export function sectionForStop(sections, stopId) {
  return (sections || []).find(sec => (sec.stops || []).includes(stopId)) || null;
}

/** 未分组站点：仍属于该路线，只是没归到任何片区。 */
export function ungroupedStops(sections, stops = []) {
  const grouped = new Set((sections || []).flatMap(sec => sec.stops || []));
  return stops.filter(id => !grouped.has(id));
}

/** 扁平序列 = 各片区顺序拼接 + 未分组补在后面，保证 route.stops 覆盖全部分区站点。 */
export function flattenStops(sections, stops = []) {
  const grouped = (sections || []).flatMap(sec => cleanIds(sec.stops));
  const rest = stops.filter(id => !grouped.includes(id));
  return [...grouped.filter((id, i, all) => all.indexOf(id) === i), ...rest];
}

export function toggleStopInSection(sections, stopId, key) {
  const target = String(key);
  const inTarget = (sections || []).find(s => s.key === target)?.stops?.includes(stopId);
  return (sections || []).map(sec => {
    const without = (sec.stops || []).filter(id => id !== stopId);
    if (!inTarget && sec.key === target) return { ...sec, stops: [...without, stopId] };
    return { ...sec, stops: without };
  });
}

/** 把站点移动到指定片区；key 传 null 表示移出所有片区（回到未分组）。 */
export function moveStopToSection(sections, stopId, key) {
  return (sections || []).map(sec => {
    const without = (sec.stops || []).filter(id => id !== stopId);
    return { ...sec, stops: sec.key === String(key) ? [...without, stopId] : without };
  });
}

/** 在两个片区之间调整站点顺序（用于修正片区内游览次序）。 */
export function reorderStopInSection(sections, key, stopId, delta) {
  return (sections || []).map(sec => {
    if (sec.key !== String(key)) return sec;
    const ids = [...(sec.stops || [])];
    const from = ids.indexOf(stopId);
    if (from < 0) return sec;
    const to = Math.min(Math.max(0, from + delta), ids.length - 1);
    if (to === from) return sec;
    ids.splice(from, 1);
    ids.splice(to, 0, stopId);
    return { ...sec, stops: ids };
  });
}

export function addSection(sections, name) {
  const base = (name || '').trim() || '未命名片区';
  const existing = new Set((sections || []).map(s => s.key));
  let key = `sec-${base}`;
  for (let i = 2; existing.has(key); i += 1) key = `sec-${base}-${i}`;
  return [...(sections || []), { key, name: base, kind: '周边景点', stops: [], text: '' }];
}

export function removeSection(sections, key) {
  return (sections || []).filter(sec => sec.key !== String(key));
}

export function updateSection(sections, key, patch) {
  return (sections || []).map(sec => (sec.key === String(key) ? { ...sec, ...patch } : sec));
}

/** 片区上移/下移：主题之间的先后即推荐游玩顺序，所以要能调。 */
export function moveSection(sections, key, delta) {
  const list = [...(sections || [])];
  const from = list.findIndex(s => s.key === String(key));
  if (from < 0) return list;
  const to = Math.min(Math.max(0, from + delta), list.length - 1);
  if (to === from) return list;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return list;
}

/** 编辑器汇总：给"还有几个点没归组"这类提示用。 */
export function groupSummary(sections, stops = []) {
  const list = sections || [];
  const ungrouped = ungroupedStops(list, stops);
  return {
    sectionCount: list.length,
    groupedCount: stops.length - ungrouped.length,
    ungrouped,
    emptySections: list.filter(sec => !(sec.stops || []).length).map(sec => sec.name),
  };
}
