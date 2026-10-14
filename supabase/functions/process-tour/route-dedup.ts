// 重复路线检测（v90）
//
// 现有去重只做"排序后站点集合完全相同"，并且整体豁免自由选点路线（v70.4），
// 结果两类问题同时存在：文档写着"重叠 >70% 视为重复"，代码做的是精确集合相等；
// 而现网确实躺着两条 10 站完全相同的路线（三清山「徒步环线」与「车行索道线」）。
//
// 相似度必须用 Jaccard（交集/并集），不能用"占较小集合的比例"：
// 2日全景游按构造就是 `[...1日核心站点, ...第二景区站点]`，
// 必然完全包含 1日线。用包含率的话 现网 18 组路线对里有 12 组会"重叠 100%"，
// 拿去删路线会直接摧毁多日线。实测 Jaccard 分布：
//   100%  三清山 徒步环线 × 车行索道线（10 站完全相同）   ← 真重复
//   100%  黄山   1日精华游 × 文学巡礼线（8 站完全相同）   ← 真重复（自由选点抄了 1 日线）
//    80%  青城山/泰山 1日精华游 × 2日全景游              ← 设计如此，必须保留
//    ≤73%  其余全部                                      ← 正常
// 因此阈值取 0.9：远高于合法包含关系，只抓真正的重复。

export type DedupRouteLike = {
  day_label?: string;
  title?: string;
  stops?: string[];
  /** 文学巡礼线等 AI 自由选点路线：不自动删除，但重复要报出来让创作者核实。 */
  _free?: boolean;
};

export const DUPLICATE_JACCARD = 0.9;
/** 少于该站点数的路线不参与重复判定：两站的"半日游"天然容易撞车。 */
export const MIN_DUP_STOPS = 3;

export type DuplicatePair = {
  keepIndex: number;
  dropIndex: number;
  similarity: number;
  identical: boolean;
  keepLabel: string;
  dropLabel: string;
  /** true = 被豁免不删（自由选点路线），需要创作者判断而不是系统删掉。 */
  exempted: boolean;
};

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a || []);
  const setB = new Set(b || []);
  if (!setA.size || !setB.size) return 0;
  let shared = 0;
  for (const id of setA) if (setB.has(id)) shared++;
  return shared / new Set([...setA, ...setB]).size;
}

function labelOf(route: DedupRouteLike, index: number): string {
  return String(route.day_label || route.title || `路线${index + 1}`);
}

/**
 * 找出重复路线对。每条路线只与"在它之前出现且未被判为重复工"的路线比较，
 * 保证保留的是优先级更高的一条（plans 顺序即 1日 → 2日 → 主题游 → 文学线）。
 */
export function findDuplicateRoutes(
  routes: DedupRouteLike[],
  options: { threshold?: number; minStops?: number } = {},
): DuplicatePair[] {
  const threshold = options.threshold ?? DUPLICATE_JACCARD;
  const minStops = options.minStops ?? MIN_DUP_STOPS;
  const pairs: DuplicatePair[] = [];
  const dropped = new Set<number>();

  routes.forEach((route, index) => {
    const stops = route.stops || [];
    if (stops.length < minStops) return;
    for (let prior = 0; prior < index; prior++) {
      if (dropped.has(prior)) continue;
      const other = routes[prior].stops || [];
      if (other.length < minStops) continue;
      const similarity = jaccardSimilarity(stops, other);
      if (similarity < threshold) continue;
      const exempted = !!route._free;
      pairs.push({
        keepIndex: prior,
        dropIndex: index,
        similarity,
        identical: similarity >= 1,
        keepLabel: labelOf(routes[prior], prior),
        dropLabel: labelOf(route, index),
        exempted,
      });
      // 豁免的重复不标记为已删，后续路线仍可与它比较（黄山文学线同时像 1日 和 2日）
      if (!exempted) dropped.add(index);
      return;
    }
  });
  return pairs;
}

export type DedupResult = {
  routes: DedupRouteLike[];
  dropped: DuplicatePair[];
  /** 站点集合重复但按设计不删的自由选点路线，需要创作者核实。 */
  suspicious: DuplicatePair[];
};

/**
 * 去掉重复路线。文学巡礼线（`_free`）只上报不删除：
 * v70.4 的结论是"它的价值在叙事，与 1日线撞站是预期行为"，
 * 但撞成完全相同仍要让人看见，所以走 suspicious 而不是静默保留。
 */
export function dedupeRoutes(routes: DedupRouteLike[]): DedupResult {
  const pairs = findDuplicateRoutes(routes);
  const dropped = pairs.filter(p => !p.exempted);
  const dropIndexes = new Set(dropped.map(p => p.dropIndex));
  return {
    routes: routes.filter((_, i) => !dropIndexes.has(i)),
    dropped,
    suspicious: pairs.filter(p => p.exempted),
  };
}
