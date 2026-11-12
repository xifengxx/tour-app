/**
 * B 层：高德结构化 POI → 可复现的候选池
 *
 * 背景（见 docs/AI-PIPELINE-DIAGNOSIS-2026-11.md 根因 1）：
 * 现在的地点清单是「AI 提名单 + 高德模糊搜索 + 事后过滤」，同一目的地跑两次可能不同。
 * 结构化检索给的是可复现的池子，但噪声很大（庐山 151 个候选里混进了植物名、展厅、
 * 商铺后缀、售票站）。这一层负责把池子洗成"人愿意看、AI 只能从这里挑"的形态。
 *
 * 原则：
 * - 只做确定性规则，不做打分模型；排序后仍需人确认（C 层）。
 * - 宁可漏，不可脏：名称明显是设施/展厅/商铺的直接丢。
 */

/** 景区名前缀，POI 常见「庐山国家级旅游风景名胜区-仙人洞」这种全名 */
const SCENIC_PREFIX = /^(.*?(风景名胜区|国家森林公园|国家重点风景名胜区|旅游景区|旅游风景区|风景区|景区))[-－—·:：]\s*/;
/** 明显不是游览点：设施、票务、商铺、展厅、住宿餐饮 */
const NON_SITE = /(售票|游客中心|服务中心|管理处|停车场|索道站|缆车站|观光车站?|公交站|卫生间|厕所|商店|便利店|超市|流通处|纪念品|展厅|多功能厅|游客服务|办公楼|会议室|餐厅|饭庄|菜馆|餐馆|小吃|快餐|咖啡|茶馆|农家乐|酒店|宾馆|民宿|客栈|停车场|码头|售票处|检票口|出入口|扶贫|直销|站$)/;
/** 植物园里的植物名录与园艺设施，不算独立游览点 */
const BOTANY = /(分类区|温室|大棚|苗圃|花圃|植物园办公楼|树$|木$|藤$|槭$|杜鹃$|山矾$|算盘子$|雷公藤$|白檀$|接骨草$|灯笼花$|糯米条$|马醉木$|马银花$|老鼠矢$)/;
/** 明确是"附属设施"的点位降权；注意别把仙人洞、御碑亭、观音桥这类真景点名误伤 */
const SECONDARY = /(观景台|观景点|石刻|摩崖|石碑|牌坊|雕塑|步道|栈道|长廊|护栏|平台$)/;

/** 去掉景区前缀、括号注释与多余空白，得到可比对的核心名 */
export function cleanPoiName(raw) {
  let s = String(raw || "").trim();
  s = s.replace(SCENIC_PREFIX, "");
  s = s.replace(/[（(][^）)]*[）)]/g, "");
  s = s.replace(/^庐山国家级旅游风景名胜区/, "");
  s = s.replace(/[\s·]+/g, "");
  return s;
}

/** 是否可能是"值得进导览的固定游览点" */
export function isTourSite(poi) {
  const name = String(poi?.name || "");
  if (!name) return false;
  if (NON_SITE.test(name)) return false;
  if (BOTANY.test(name)) return false;
  if (name.length < 2) return false;
  if (name.length > 22) return false; // 超长名多半是场馆里的子展项
  return true;
}

/** 同一点位的两个名字是否指同一处（去重用） */
export function sameSite(a, b) {
  const na = cleanPoiName(a);
  const nb = cleanPoiName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  return na.includes(nb) || nb.includes(na);
}

function distM(a, b) {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** 点位的排位：国家级/省级景点、评分、名称里是否含目的地、二级点位降权 */
function rankScore(p, destName) {
  let s = 0;
  if (/1102/.test(String(p.typecode || ""))) s += 6;
  s += Number(p.rating || 0) * 2;
  if (destName && String(p.name).includes(destName)) s += 1.5;
  if (SECONDARY.test(String(p.name))) s -= 3;
  if (String(p.name).length <= 6) s += 0.5;
  return s;
}

/**
 * @param {Array<{name:string, lat:number, lng:number, rating?:number, typecode?:string, type?:string}>} candidates
 * @param {{destName?:string, limit?:number, minRating?:number, dedupM?:number}} opts
 * @returns {{pool: Array, dropped: {nonSite:number, lowRating:number, dup:number}}}
 */
export function buildPool(candidates, opts = {}) {
  const { destName = "", limit = 40, minRating = 0, dedupM = 150 } = opts;
  const dropped = { nonSite: 0, lowRating: 0, dup: 0 };
  const kept = [];

  for (const p of candidates || []) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (!isTourSite(p)) { dropped.nonSite += 1; continue; }
    const rated = Number(p.rating || 0);
    // 没有评分的老景区点允许保留；有评分但过低且非国家级的丢弃
    if (rated && rated < minRating && !/110202/.test(String(p.typecode || ""))) {
      dropped.lowRating += 1;
      continue;
    }
    const item = { ...p, clean: cleanPoiName(p.name), score: rankScore(p, destName) };
    const near = kept.find((k) => distM(k, item) < dedupM || sameSite(k.name, item.name));
    if (near) {
      dropped.dup += 1;
      if (item.score > near.score) Object.assign(near, item);
      continue;
    }
    kept.push(item);
  }

  kept.sort((a, b) => b.score - a.score);
  return { pool: kept.slice(0, limit), dropped };
}

/** 给 AI 的候选池文本：只列"能选的点"，ID 由顺序生成 */
export function poolPromptLines(pool) {
  return pool.map((p, i) => `${i + 1}. ${p.clean || p.name}${p.rating ? `（${p.rating}★）` : ""}`).join("\n");
}
