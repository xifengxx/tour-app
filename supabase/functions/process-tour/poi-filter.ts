// 非游览点过滤（P1-4）
//
// 历史上这套规则散在 index.ts 内联判断里，只覆盖了"AI 首层提取"这一个入口，
// 而地点实际有五个入口：AI 提取 / AI 核心补全 / AI 地区提议 / 高德地区知名景点 /
// 锚点子景点扫描。结果是地区合并路径进来的点完全不过滤：
//   · 武当山 2日线出现「玄岳门(公交站)」——公交站被当成景点排进动线
//   · 泰山 2日线出现「两期岩体穿插关系」——地质说明文字被高德当 POI 返回
//   · 丽江地点表出现「凌雪草坪(礼成旅行婚礼)」——婚礼场地
// 本模块把规则收敛成单一判据，供所有入口复用。
//
// 注意：这里**不**使用 FACILITY_RE。FACILITY_RE 含 `栈道$|步道$|观景台$|索道站$|广场$`
// 等模式，用于子景点扫描合适，但会误杀「金龙峡栈道」「冰川公园栈道」这类真实游览点，
// 首层提取当初就是因此刻意不用它（见 index.ts 注释）。

import { JUNK_RE } from "./gaode-scan.ts";
import { AMUSE_RE } from "./gaode-search.ts";

/** 交通与服务设施：站/场/售验票/出入口等，本身不是游览对象。 */
export const INFRA_RE = /车站$|停车场|售票|游客中心|服务(?:中心|区|站|处)|管理处|管委会|监测|接待|讲解|卫生间|厕所|公交站|地铁站|候车|入口$|出口$|门店|商店|超市|银行|加油站/;

/**
 * 游客真正会经过的换乘/入口设施。它们不是"景点"，但确实是动线节点
 * （"从游客中心乘索道进入"），所以步道补全与路线图绑定要区别对待：
 * 厕所、候车厅、售票处不能被当成游览点，游客中心和索道站可以。
 */
export const TRANSFER_POI_RE = /游客中心|游客服务中心|服务中心|索道|缆车|观光车|游览车|电瓶车|接驳车|候车(?:厅|区|点|室)|站台|停车场|换乘中心|售票处?|入口|出口|大门|北门|南门|东门|西门/;

/** 该点名是否属于"可作动线节点的换乘/入口设施"。 */
export function isTransferPOI(name: unknown): boolean {
  return TRANSFER_POI_RE.test(String(name || ""));
}

/** 地质与科研描述：高德/维基会把"两期岩体穿插关系""断层构造"这类条目作为 POI 返回。 */
export const NON_SIGHT_RE = /岩体|地层|地质构造|断层|剖面|化石|群核|观测站|监测站|气象站|科研|试验基地|保护区管理局|婚礼|旅拍|婚纱摄影|演艺中心|大剧院|会展/;

export type PoiFilterOptions = {
  /** 额外拒绝的模式列表（调用方按入口补充）。 */
  extra?: RegExp[];
};

/**
 * 判定一个候选名是否根本不是可游览地点。
 * 命中任一规则即拒绝，并返回命中的规则名，便于写进告警让创作者看到原因。
 */
export function rejectReasonForPOI(name: unknown, options: PoiFilterOptions = {}): string | null {
  const value = String(name || "");
  if (!value.trim()) return "空名称";
  if (INFRA_RE.test(value)) return "交通/服务设施";
  if (JUNK_RE.test(value)) return "餐饮住宿商业";
  if (AMUSE_RE.test(value)) return "游乐商业场所";
  if (NON_SIGHT_RE.test(value)) return "非游览对象（地质/科研/商业场地）";
  for (const re of options.extra || []) if (re.test(value)) return "自定义规则";
  return null;
}

export function isNonSitePOI(name: unknown, options: PoiFilterOptions = {}): boolean {
  return rejectReasonForPOI(name, options) != null;
}

/** 地点对象的便捷重载：读 loc.name。 */
export function isNonSiteLocation(loc: { name?: unknown } | null | undefined, options: PoiFilterOptions = {}): boolean {
  if (!loc) return true;
  return isNonSitePOI(loc.name, options);
}
