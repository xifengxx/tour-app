/**
 * 发现页搜索/分类的纯逻辑（可测试）。
 */

/** 从目的地名关键词推断导览类型 */
export function classifyTour(tour) {
  const name = tour.destination?.name || '';
  if (/山|峰|岳|岭/.test(name)) return '名山';
  if (/湖|江|海|溪|泉/.test(name)) return '湖泊';
  if (/寺|院|祠|书院|庙|塔/.test(name)) return '人文';
  return '其他';
}

/** 按关键词搜索标题/副标题/目的地名/地区 */
export function searchTours(tours, keyword) {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) return tours;
  return tours.filter(t =>
    [t.title, t.subtitle, t.destination?.name, t.destination?.region]
      .filter(Boolean)
      .some(v => v.toLowerCase().includes(kw))
  );
}

/** 按分类过滤（'全部' 或空 = 不过滤） */
export function filterByCategory(tours, category) {
  if (!category || category === '全部') return tours;
  return tours.filter(t => classifyTour(t) === category);
}
