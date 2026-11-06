// 案头/机位内容以仓库内 JSON 为主：这类「资料型」内容需要能 diff、能 review、能追版本，
// 放在数据库 jsonb 里反而不好核对，而且加列要动迁移。库里有值时仍以库为准，这里只做兜底。
//
// 每个导览一个文件（src/data/story/<slug>.json），这里自动注册：
// 新增一个导览的内容只要丢一份 JSON 进去，不用改代码。
const modules = import.meta.glob('../data/story/*.json', { eager: true });

const byTour = {};
for (const mod of Object.values(modules)) {
  const data = mod?.default ?? mod;
  if (data?.tourId && data.locations) byTour[data.tourId] = data;
}

/** 取某个导览的案头内容；没有就返回 null（前端走空态，不编造） */
export function storySeedFor(tourId) {
  return (tourId && byTour[tourId]) || null;
}

/** 这份案头内容里是否真有条目——决定「首访要不要先铺一屏案头」 */
export function hasSeedStory(seed) {
  if (!seed?.locations) return false;
  return Object.values(seed.locations).some(
    v => (v.timeline?.length || 0) > 0 || (v.figures?.length || 0) > 0,
  );
}

/** 已覆盖的导览数（用于自检/统计） */
export function seededTourCount() {
  return Object.keys(byTour).length;
}
