// 案头内容以仓库内 JSON 为主：这类「资料型」内容需要能 diff、能 review、能追版本，
// 放在数据库 jsonb 里反而不好核对，而且加列要动迁移。库里有值时仍以库为准，这里只做兜底。
import lushan from '../data/story/lushan.json';

const SEEDS = [lushan];
const byTour = Object.fromEntries(SEEDS.filter(s => s?.tourId).map(s => [s.tourId, s]));

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
