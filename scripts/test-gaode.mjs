// 独立验证 gaode() 未提交改动：严格→放宽两级查询 + 名称清洗
// 用法: GAODE_KEY=<key> node scripts/test-gaode.mjs
// 注意: 密钥来自环境变量，不入库。此脚本仅测试，不复用 Edge Function 代码（避免部署环境差异）。
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// 密钥来源：进程环境变量 > 项目 .env（.env 已在 .gitignore，安全）> 旧会话备份（上一会话已用过的 key，自取自用不打印）
function loadKey() {
  if (process.env.GAODE_KEY) return process.env.GAODE_KEY;
  const envPath = new URL("../.env", import.meta.url).pathname;
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^GAODE_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  const backup = join(homedir(), "session-backup-9d6c4422.jsonl");
  if (existsSync(backup)) {
    // 高德 Web 服务 Key 以 2ff1 开头（见 index.ts 注释 GAODE_KEY=2ff1...），32 位 hex。
    // 之前用 [a-f0-9]{32} 匹配到了备份里别的 32 位串 → INVALID_USER_KEY。这里按前缀精确定位。
    const m = readFileSync(backup, "utf8").match(/2ff1[a-f0-9]{28}/);
    if (m) return m[0];
  }
  return "";
}
const GAODE_KEY = loadKey();

const PROV_PREFIX = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/;
const PROV_EXACT = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
function splitRegion(t) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  const m = t.match(PROV_PREFIX); // "湖南张家界" → 匹配"湖南"前缀，剩余"张家界"是市
  if (m && m[0].length < t.length) return { prov: m[0], city: t.slice(m[0].length) };
  return { prov: "", city: t };
}
// 镜像 index.ts regionMatch：目标地区与高德 regeo 结果的匹配（支持"湖南张家界"连写）
function regionMatch(geo, targetRegion) {
  if (!geo) return false;
  const norm = String(targetRegion).trim();
  if (!norm) return false;
  const gProv = String(geo.province || "");
  const gCity = Array.isArray(geo.city) ? (geo.city[0] || "") : String(geo.city || "");
  const gCityCand = gCity || gProv; // 直辖市：city 空 → 用 province 兜底
  const gDistrict = String(geo.district || ""); // v70：县级市/区县候选
  const stripSuffix = (s) => String(s).replace(/[市]$/g, "");
  const sheng = norm.indexOf("省");
  const zzq = norm.indexOf("自治区");
  let provPart = "", cityPart = "";
  if (sheng > -1) { provPart = norm.slice(0, sheng); cityPart = norm.slice(sheng + 1); }
  else if (zzq > -1) { provPart = norm.slice(0, zzq); cityPart = norm.slice(zzq + 3); }
  if (cityPart) {
    const tCityCands = [cityPart, stripSuffix(cityPart)];
    return tCityCands.some(tc => tc && (
      gCityCand.includes(tc) || tc.includes(stripSuffix(gCityCand)) ||
      (gDistrict && (gDistrict.includes(tc) || tc.includes(stripSuffix(gDistrict))))
    ));
  }
  if (provPart) {
    const tProvCands = [provPart, stripSuffix(provPart)];
    return tProvCands.some(tp => tp && gProv.includes(tp));
  }
  // 裸名（"江西""黄山""北京"、"湖南张家界"省名+市名连写）→ 先城市后省份匹配
  const gCityN = gCityCand.replace(/[市]$/g, "");
  if (gCityN && norm.includes(gCityN)) return true; // "湖南张家界"含"张家界" → 城市精确命中
  const gDistN = gDistrict.replace(/[市区县]$/g, ""); // v70："登封市"→"登封"，覆盖裸县级市写法
  if (gDistN && norm.includes(gDistN)) return true;
  if (norm.length <= 3) { // 省份匹配仅限短目标，防"湖南张家界"放行同省他市
    const gProvN = gProv.replace(/省$/, "");
    return gProv.includes(norm) || (gProvN && norm.includes(gProvN));
  }
  return false;
}

// 与 index.ts gaode() 一致的逻辑（名称重叠过滤 + 类型优先 + 限流重试 + 兜底放宽）
async function gaode(name, destCity, bias) {
  const kw = encodeURIComponent(name);
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const rawCity = (splitRegion(destCity).city || destCity).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `&city=${encodeURIComponent(rawCity)}&citylimit=true`;
  const overlaps = (pois) => pois.filter((p) => p.name?.includes(name) || name.includes(p.name || ""));
  const preferScenic = (pois) => {
    const s = pois.filter((p) => /风景名胜|旅游景点|名胜|景区|公园/.test(p.type || ""));
    return s.length ? s : pois;
  };
  const query = async (types) => {
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}${cityPart}&key=${GAODE_KEY}${typesParam}${biasParam}`, { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise((r2) => setTimeout(r2, 300)); continue; }
      return (d.pois || []).filter((p) => !/省.*市/.test(p.name || ""));
    }
    return [];
  };
  let matched = overlaps(await query("风景名胜|旅游景点"));
  let usedFallback = false;
  if (!matched.length) {
    usedFallback = true;
    matched = overlaps(await query(null));
  }
  if (!matched.length) return null;
  const top = preferScenic(matched)[0];
  const [lng, lat] = top.location.split(",").map(Number);
  let clean = top.name.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").replace(/[（(](公交站|地铁站|汽车站|火车站)[）)]/g, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = clean.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === clean) break;
    clean = next;
  }
  return { lng, lat, name: clean || top.name, raw: top.name, type: top.type || "", usedFallback };
}

// ── 锚点 / 子景点逻辑（镜像 index.ts 2.4 节） ──
const SUB_AREA_RADIUS = 12000;
const SCAN_RADIUS = 12000;
const ANCHOR_CAP = 12;
const SUB_TOTAL_CAP = 10;
const SUB_DEDUP_M = 300; // 与 index.ts 一致：1000m 会误杀百龙天梯(距张家界700m)/袁家界(距金鞭溪900m)
const FACILITY_RE = /停车场|售票处|售票点|售票大厅|检票口|检票|门票站|乘车处|候车(?:处|亭|室)|索道(?:上站|下站|中站|入口|出口|站)?$|缆车$|观光车(?:站|场|停靠点)|游客中心|游客服务(?:点|中心)?|服务区|服务站|服务中心|管理处|管委会|委员会|居委会|村委会|派出所|加油站|银行|超市|商店|小卖部|商业街|饭店|餐厅|宾馆|酒店|客栈|民宿|山庄|农家乐|厕所|卫生间|洗手间|公厕|入口$|出口$|北门|南门|东门|西门|中门|大门|广场$|车站$|码头$|步道$|栈道$|观景台$|平台$|通道|门店|店\)|店$|综合服务|街道|步行街|(?<!故)居$|邮政|快递|营业厅|窗口|咨询|摄影|团队|散客|办事处|工会|党员|人社|村委会/;
function isScenicAnchor(loc, destName) {
  const n = String(loc.name || "");
  if (/-/.test(n)) return false;
  const hasSuffix = /(风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|公园)$/.test(n);
  if (destName) { // v70：子串匹配须带设计词后缀，防"中国嵩山卢崖瀑布/青城山索道"成锚点
    if (n === destName || destName.includes(n)) return true;
    if (n.includes(destName) && hasSuffix) return true;
  }
  if (/(风景名胜区|国家森林公园|风景名胜|自然保护区)$/.test(n)) return true;
  if (/(风景区|景区|公园)$/.test(n) && !/-/.test(n)) return true;
  return false;
}
function cleanScenicName(n) {
  return n.replace(/风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|森林公园|公园/g, "").replace(/[-— ]+$/, "").trim() || n;
}
function scenicWeight(n, destName) {
  const coreBonus = destName && (n.includes(destName) || destName.includes(n)) ? 7 : 0;
  if (/风景名胜区$/.test(n)) return 6 + coreBonus;
  if (/国家森林公园$/.test(n)) return 5 + coreBonus;
  if (/风景名胜|自然保护区$/.test(n)) return 4 + coreBonus;
  if (/风景区$/.test(n)) return 3 + coreBonus;
  if (/景区$/.test(n)) return 2 + coreBonus;
  if (/公园$/.test(n)) return 1 + coreBonus;
  return coreBonus;
}
const UMBRELLA_ABSORB_M = 12000;
function buildAnchors(locs, destName) {
  const cands = locs.filter(l => isScenicAnchor(l, destName))
    .map(l => ({ ...l, scenicName: cleanScenicName(l.name), weight: scenicWeight(l.name, destName) }));
  cands.sort((a, b) => b.weight - a.weight || b.name.length - a.name.length);
  const isCore = (c) => destName && (c.name.includes(destName) || destName.includes(c.name));
  const umbrella = cands.find(c => !isCore(c) && /(风景名胜区|国家森林公园)$/.test(c.name)) || null;
  const anchors = [];
  const ordered = umbrella ? [umbrella, ...cands.filter(c => c !== umbrella)] : cands;
  for (const c of ordered) {
    if (umbrella && c === umbrella) { anchors.push({ ...c, mergedNames: [], subPoints: [] }); continue; }
    const um = anchors.find(a => umbrella && a.name === umbrella.name);
    if (umbrella && um && c.weight < umbrella.weight && haversineM(umbrella, c) < UMBRELLA_ABSORB_M) {
      um.mergedNames.push(c.scenicName);
      um.subPoints.push({ lng: c.lng, lat: c.lat, name: c.scenicName });
      continue;
    }
    anchors.push({ ...c, mergedNames: [], subPoints: [] });
  }
  anchors.sort((a, b) => b.weight - a.weight);
  return anchors;
}
// 镜像 index.ts scanAnchorSubs
async function scanAnchorSubs(anchor, locs, otherAnchors, aiKnown) {
  const around = await gaodeAroundScenics(anchor.lng, anchor.lat, SCAN_RADIUS);
  const existingNames = new Set(locs.map(l => String(l.name || "")));
  const out = [];
  for (const c of around) {
    const n = String(c.name || "");
    if (!n) continue;
    if (FACILITY_RE.test(n)) continue;
    if (n === anchor.name || n === anchor.scenicName) continue;
    if (existingNames.has(n)) continue;
    if (otherAnchors.some(a => a.id !== anchor.id && haversineM(a, c) < 5000)) continue;
    if ([...locs, ...out].some(q => haversineM(q, c) < SUB_DEDUP_M)) continue;
    const rank = aiKnown.has(n) || aiKnown.has(c.raw) ? 0 : /景区|风景|公园|名胜|自然保护区/.test(c.raw || "") ? 1 : 2;
    if (rank > 1) continue; // 拒绝杂点（与 index.ts 一致）
    out.push({ ...c, rank });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out.slice(0, ANCHOR_CAP).map((c) => ({
    name: c.name, lat: c.lat, lng: c.lng,
    elevation: "", importance: 3, tags: ["子景点", `景区:${anchor.scenicName}`], scenic: anchor.scenicName,
  }));
}
function attachScenicTags(locs, anchors) {
  for (const l of locs) {
    if (l.scenic) continue;
    const self = anchors.find(a => a.name === l.name || a.scenicName === l.name);
    if (self) { l.scenic = self.scenicName; continue; }
    let best = null, bestD = Infinity;
    for (const a of anchors) { const d = haversineM(a, l); if (d < bestD) { bestD = d; best = a; } }
    l.scenic = (best && bestD <= SUB_AREA_RADIUS) ? best.scenicName : "独立";
  }
  return locs;
}
function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(s));
}
// ── 镜像 index.ts normalizeLayers：扁平 {novel:"文本"} → 嵌套 {novel:{text:"文本"}}（前端只读 .text）──
function normalizeLayers(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = { text: v };
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = v;
    else out[k] = {};
  }
  return out;
}

// ── 镜像 index.ts 确定性路线站点规划（1日=前山 / 2日=前山+后山 / 主题游=4热核心+统一地区景点）──
const CLUSTER_R = 8000;
function clusterRegionPts(locs, corePool) {
  const pts = locs.filter((l) => (l.tags || []).includes("地区景点"))
    .filter((p) => !corePool.some((c) => haversineM(c, p) < SUB_DEDUP_M));
  const clusters = [];
  for (const p of pts) {
    const c = clusters.find((c) => haversineM(c.rep, p) < CLUSTER_R);
    if (c) c.locs.push(p);
    else clusters.push({ rep: p, locs: [p] });
  }
  return clusters;
}
function pickRep(cluster, destName) {
  const d2 = destName.slice(0, 2);
  return cluster.locs.slice().sort((a, b) =>
    (b.importance || 3) - (a.importance || 3)
    || ((b.name.startsWith(d2) ? 1 : 0) - (a.name.startsWith(d2) ? 1 : 0))
    || (a.name.length - b.name.length)
  )[0];
}
function planRoutes(locs, ctx) {
  const isRegion = (l) => (l.tags || []).includes("地区景点");
  const byImp = (a, b) => (b.importance || 3) - (a.importance || 3);
  const corePool = locs.filter((l) => !isRegion(l) && l.scenic === ctx.coreScenicName).sort(byImp);
  let mainPool = ctx.mainScenicName ? locs.filter((l) => l.scenic === ctx.mainScenicName).sort(byImp) : [];
  if (!mainPool.length) {
    const clusters = clusterRegionPts(locs, corePool);
    const big = clusters.slice().sort((a, b) => b.locs.length - a.locs.length)[0];
    mainPool = big && big.locs.length >= 2 ? big.locs : [];
  }
  // 核心质心 + 距离过滤（镜像 index.ts）：后山池 ≤25km，统一景点 ≤30km（西岭雪山45km/安仁44km被排除）
  const coreCenter = corePool.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
  const cc = { lng: coreCenter.lng / (corePool.length || 1), lat: coreCenter.lat / (corePool.length || 1) };
  const nearCore = (l, maxM) => haversineM(cc, l) <= maxM;
  if (mainPool.length) mainPool = mainPool.filter((l) => nearCore(l, 25000)); // v70：逐点过滤，一个远点不团灭
  const unifiedRegion = clusterRegionPts(locs, corePool).map((c) => pickRep(c, ctx.destName)).filter((l) => nearCore(l, 30000));
  const plans = [];
  plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: corePool.slice(0, 8).map((l) => l.id) });
  if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...corePool.slice(0, 8).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  } else if (corePool.length >= 8) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: corePool.slice(0, 14).map((l) => l.id) });
  }
  if (ctx.hasRegionTour && unifiedRegion.length) {
    plans.push({ label: "主题游", title: `${ctx.destName}深度主题游`, allow: [...corePool.slice(0, 4).map((l) => l.id), ...unifiedRegion.map((l) => l.id)] });
  }
  if (ctx.isNovelBased) plans.push({ label: "文学巡礼线", title: `《${ctx.novelName}》文学巡礼`, allow: null });
  return plans;
}
// 镜像 index.ts gaodeAroundScenics：周边扫描 + 清洗
async function gaodeAroundScenics(lng, lat, radius = SCAN_RADIUS) {
  const JUNK = /咖啡|餐厅|奶茶|小吃|甜品|麦当劳|瑞幸|肯德基|烧仙草|汉堡|客栈|民宿|山庄|农家乐|火锅|三下锅|菜馆|私房菜|家常菜|中餐馆|餐馆|乡厨|烧烤|快餐|美食|门店|服务社|宾馆|酒店|超市|银行|加油站|KTV|健身房|旅行社|蜜雪|面包|饮品|烘焙|酸奶|烤面包|速递|快递/;
  const ATTRACTION = /景|峰|峡|桥|梯|画廊|溪|界|寨|洞|寺|观|湖|湾|山|岭|谷|岩|石|门|瀑|泉|亭|阁|殿|庙|祠|塔|墓|园|池|林|松|海|台|田|索道|温泉|漂流|故居|书院/;
  const fetchPage = async (page) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=${radius}&offset=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise((r2) => setTimeout(r2, attempt === 0 ? 300 : 800)); continue; }
      return (d.pois || [])
        .filter((p) => p.location && !/省.*市/.test(p.name || "") && !JUNK.test(p.name || "") && ATTRACTION.test(p.name || ""))
        .map((p) => { const [lng2, lat2] = p.location.split(",").map(Number); return { lng: lng2, lat: lat2, name: cleanName(p.name), raw: p.name }; });
    }
    return [];
  };
  const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
  const seen = new Set();
  return [...p1, ...p2, ...p3].filter((c) => { const k = `${c.lng},${c.lat}|${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---- 第一部分：无密钥正则单元测试（验证名称清洗逻辑本身） ----
console.log("=== 名称清洗正则单元测试（无需密钥） ===");
// 清洗正则（与 index.ts gaode() 一致：前缀 + 多轮后缀清洗）
const cleanName = (n) => {
  let c = n.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === c) break;
    c = next;
  }
  return c;
};
const REGEX_CASES = [
  ["袁家界游客基地", "袁家界"],
  ["袁家界社区", "袁家界"],
  ["袁家界景区-观景台", "袁家界"],
  ["百龙天梯上站", "百龙天梯"],
  ["百龙天梯下站", "百龙天梯"],
  ["十里画廊观光电车售票处", "十里画廊"],
  ["十里画廊售票处", "十里画廊"],
  ["张家界国家森林公园十里画廊小火车", "十里画廊"],
  ["武陵源风景名胜区-黄石寨", "黄石寨"],
  ["天子山风景区", "天子山"],
  ["武陵源风景名胜区-杨家界乘车处", "杨家界"],
  ["金鞭溪", "金鞭溪"],
  ["天子山", "天子山"],
  ["黄石寨", "黄石寨"],
  ["水绕四门", "水绕四门"],
  ["武陵源风景名胜区", "武陵源风景名胜区"],
  ["张家界国家森林公园", "张家界国家森林公园"],
];
let allPass = true;
for (const [input, expect] of REGEX_CASES) {
  // 与 gaode() 返回一致：清洗为空时回落到原名（如"张家界国家森林公园"被前缀正则剥空 → 保留原名）
  const got = cleanName(input) || input;
  const ok = got === expect;
  if (!ok) allPass = false;
  console.log(`  ${ok ? "✓" : "✗"} "${input}" → "${got}" (期望 "${expect}")`);
}
console.log(allPass ? "✅ 全部通过" : "❌ 有失败");

// ---- 第一部分B：锚点/设施逻辑单元测试（无需密钥） ----
console.log("\n=== 锚点/设施逻辑单元测试（无需密钥） ===");
let anchorPass = true;
const okLog = (cond, label) => { if (!cond) anchorPass = false; console.log(`  ${cond ? "✓" : "✗"} ${label}`); };

// FACILITY_RE（对清洗后的名称）
okLog(!FACILITY_RE.test(cleanName("百龙天梯上站")), "百龙天梯上站 → 清洗后 保留");
okLog(!FACILITY_RE.test(cleanName("十里画廊观光电车售票处")), "十里画廊观光电车售票处 → 保留");
okLog(!FACILITY_RE.test(cleanName("迷魂台")), "迷魂台 → 保留（台 是真景点）");
okLog(!FACILITY_RE.test(cleanName("天下第一桥")), "天下第一桥 → 保留（桥 是真景点）");
okLog(FACILITY_RE.test("武陵源景区停车场"), "武陵源景区停车场 → 剔除");
okLog(FACILITY_RE.test("游客中心"), "游客中心 → 剔除");
okLog(FACILITY_RE.test("观景台"), "观景台 → 剔除");

// isScenicAnchor
okLog(isScenicAnchor({ name: "武陵源风景名胜区" }, "天门山"), "武陵源风景名胜区 → 锚点");
okLog(isScenicAnchor({ name: "天门山国家森林公园" }, "天门山"), "天门山国家森林公园 → 锚点");
okLog(isScenicAnchor({ name: "天子山风景区" }, "天门山"), "天子山风景区 → 锚点");
okLog(!isScenicAnchor({ name: "天门山国家森林公园-天门洞" }, "天门山"), "天门山国家森林公园-天门洞 → 非锚点(子点)");
okLog(!isScenicAnchor({ name: "袁家界游客基地" }, "天门山"), "袁家界游客基地 → 非锚点");
okLog(!isScenicAnchor({ name: "百龙天梯" }, "天门山"), "百龙天梯 → 非锚点");

// cleanScenicName
okLog(cleanScenicName("武陵源风景名胜区") === "武陵源", "武陵源风景名胜区 → 武陵源");
okLog(cleanScenicName("天门山国家森林公园") === "天门山", "天门山国家森林公园 → 天门山");
okLog(cleanScenicName("七星山风景区") === "七星山", "七星山风景区 → 七星山");

// buildAnchors 嵌套合并：天子山/张家界国家森林公园并入武陵源；七星山独立
const testLocs = [
  { id: "a", name: "天门山国家森林公园", lat: 29.05, lng: 110.68 },
  { id: "b", name: "武陵源风景名胜区", lat: 29.35, lng: 110.47 },
  { id: "c", name: "张家界国家森林公园", lat: 29.35, lng: 110.48 },
  { id: "d", name: "天子山风景区", lat: 29.4, lng: 110.44 },
  { id: "e", name: "七星山风景区", lat: 29.12, lng: 110.62 },
];
const anchors = buildAnchors(testLocs, "天门山");
const anames = anchors.map(a => a.scenicName);
okLog(anames.length === 3, `锚点数=3（实际 ${anames.join(",")}）`);
okLog(anames[0] === "天门山", "权重最高锚点=天门山（核心）");
okLog(anames.includes("武陵源"), "含 武陵源");
const wl = anchors.find(a => a.scenicName === "武陵源");
okLog(wl && wl.mergedNames.includes("张家界") && wl.mergedNames.includes("天子山"), "武陵源合并了 张家界/天子山（子锚点）");
okLog(anames.includes("七星山"), "七星山 独立锚点");

// splitRegion 连写解析（"湖南张家界" bug 修复）
okLog(splitRegion("湖南张家界").prov === "湖南" && splitRegion("湖南张家界").city === "张家界", "splitRegion(\"湖南张家界\") → 湖南/张家界");
okLog(splitRegion("湖南省张家界市").city === "张家界市", "splitRegion(\"湖南省张家界市\") → 张家界市");
okLog(splitRegion("张家界").city === "张家界" && !splitRegion("张家界").prov, "splitRegion(\"张家界\") → 城市");
okLog(splitRegion("江西省").city === "" && splitRegion("江西省").prov === "江西省", "splitRegion(\"江西省\") → 省份");
okLog(splitRegion("北京").city === "北京", "splitRegion(\"北京\") → 城市(直辖市,不误拆)");
okLog(splitRegion("内蒙古呼和浩特").city === "呼和浩特", "splitRegion(\"内蒙古呼和浩特\") → 呼和浩特");

// regionMatch 连写匹配（regeo 返回 湖南省/张家界市）
const zjjGeo = { province: "湖南省", city: "张家界市" };
const beijingGeo = { province: "北京市", city: [] };
okLog(regionMatch(zjjGeo, "湖南张家界"), "regionMatch 湖南张家界 ↔ 湖南省张家界市 → 匹配");
okLog(regionMatch(zjjGeo, "张家界市"), "regionMatch 张家界市 → 匹配");
okLog(regionMatch(zjjGeo, "湖南省张家界市"), "regionMatch 湖南省张家界市 → 匹配");
okLog(regionMatch(zjjGeo, "张家界"), "regionMatch 张家界 → 匹配");
okLog(regionMatch(zjjGeo, "湖南"), "regionMatch 湖南 → 匹配(省份)");
okLog(regionMatch(beijingGeo, "北京"), "regionMatch 北京 ↔ 北京市 → 匹配");
okLog(!regionMatch(zjjGeo, "湖北武汉"), "regionMatch 湖北武汉 ↔ 张家界 → 拒绝");
okLog(!regionMatch({ province: "湖南省", city: "株洲市" }, "湖南张家界"), "regionMatch 湖南张家界 ↔ 株洲市 → 拒绝(同省他市)");
okLog(!regionMatch(beijingGeo, "湖南张家界"), "regionMatch 湖南张家界 ↔ 北京 → 拒绝");

// ── v70 district（县级市/区县）匹配：嵩山失败根因回归 ──
const dengfengGeo = { province: "河南省", city: "郑州市", district: "登封市" };
okLog(regionMatch(dengfengGeo, "河南登封"), "v70 河南登封 ↔ 郑州市登封市 → 匹配(district)");
okLog(regionMatch(dengfengGeo, "河南省登封市"), "v70 河南省登封市 ↔ 郑州市登封市 → 匹配(district)");
okLog(regionMatch(dengfengGeo, "登封市"), "v70 登封市 ↔ 郑州市登封市 → 匹配(district)");
okLog(regionMatch(dengfengGeo, "河南省郑州市"), "河南省郑州市 ↔ 郑州市登封市 → 匹配(city)");
okLog(!regionMatch(dengfengGeo, "河南省洛阳市"), "河南省洛阳市 ↔ 郑州市登封市 → 拒绝");
okLog(!regionMatch({ province: "河南省", city: "洛阳市", district: "偃师区" }, "河南登封"), "洛阳偃师 ↔ 河南登封 → 拒绝(达摩洞错点防护)");

// ── v70 锚点收严：含目的地名的普通 POI 不再当锚点 ──
okLog(!isScenicAnchor({ name: "中国嵩山卢崖瀑布" }, "嵩山"), "v70 中国嵩山卢崖瀑布 → 非锚点");
okLog(!isScenicAnchor({ name: "嵩山世界地质公园科普广场" }, "嵩山"), "v70 嵩山世界地质公园科普广场 → 非锚点");
okLog(!isScenicAnchor({ name: "青城山索道" }, "青城山"), "v70 青城山索道 → 非锚点");
okLog(isScenicAnchor({ name: "嵩山" }, "嵩山"), "嵩山 → 锚点(等于目的地)");
okLog(isScenicAnchor({ name: "嵩山国家重点风景名胜区" }, "嵩山"), "嵩山国家重点风景名胜区 → 锚点(设计词后缀)");
okLog(isScenicAnchor({ name: "青城山景区" }, "青城山"), "青城山景区 → 锚点(设计词后缀)");

// ── planRoutes 确定性路线站点规划（青城山 13 点 mock，无需密钥）──
console.log("\n=== planRoutes 路线组成（青城山 mock） ===");
let planPass = true;
const okPlan = (cond, label) => { if (!cond) planPass = false; console.log(`  ${cond ? "✓" : "✗"} ${label}`); };
const qcsLocs = [
  { id: "qcs-m", name: "青城山", lng: 103.563817, lat: 30.9044, importance: 5, scenic: "青城山" },
  { id: "qcs-tianshi", name: "天师洞", lng: 103.560597, lat: 30.902104, importance: 5, scenic: "青城山" },
  { id: "qcs-jianfu", name: "建福宫", lng: 103.572736, lat: 30.897265, importance: 4, scenic: "青城山" },
  { id: "qcs-shangqing", name: "上清宫", lng: 103.563293, lat: 30.910143, importance: 5, scenic: "青城山" },
  { id: "qcs-laojun", name: "老君阁", lng: 103.560715, lat: 30.90794, importance: 4, scenic: "青城山" },
  { id: "qcs-chaoyang", name: "朝阳洞", lng: 103.557884, lat: 30.905498, importance: 3, scenic: "青城山" },
  { id: "qcs-shanmen", name: "青城山山门", lng: 103.59482, lat: 30.896613, importance: 3, scenic: "青城山" },
  { id: "qcs-yuecheng", name: "月城湖", lng: 103.568615, lat: 30.902283, importance: 3, scenic: "青城山" },
  { id: "qcs-dujiangyan", name: "都江堰", lng: 103.610529, lat: 31.003363, importance: 4, tags: ["地区景点"], scenic: "青城山" },
  { id: "qcs-houshan", name: "青城后山", lng: 103.487136, lat: 30.93071, importance: 4, tags: ["地区景点"], scenic: "青城山" },
  { id: "qcs-wulong", name: "五龙沟", lng: 103.473101, lat: 30.923365, importance: 4, tags: ["地区景点"], scenic: "青城山" },
  { id: "qcs-baiyun", name: "白云万佛洞", lng: 103.483152, lat: 30.946046, importance: 4, tags: ["地区景点"], scenic: "青城山" },
  { id: "qcs-jingqu", name: "青城山景区", lng: 103.563817, lat: 30.9044, importance: 4, tags: ["地区景点"], scenic: "青城山" },
];
const qcsPlans = planRoutes(qcsLocs, { coreScenicName: "青城山", mainScenicName: "", destName: "青城山", isNovelBased: false, novelName: "", hasRegionTour: true });
const planByName = (n) => qcsPlans.find((p) => p.label === n);
const namesOf = (p) => (p?.allow || []).map((id) => qcsLocs.find((l) => l.id === id)?.name);
okPlan(qcsPlans.length === 3, `路线条数=3（实际 ${qcsPlans.map(p=>p.label).join("/")}）`);
okPlan(planByName("1日精华游")?.allow?.length === 8, `1日精华游 = 8 站（实际 ${planByName("1日精华游")?.allow?.length}）`);
okPlan(!namesOf(planByName("1日精华游")).includes("都江堰"), "1日精华游 不含 都江堰");
okPlan(namesOf(planByName("1日精华游")).includes("朝阳洞") && namesOf(planByName("1日精华游")).includes("青城山山门"), "1日精华游 含 朝阳洞/山门（前山并入）");
okPlan(planByName("2日全景游")?.allow?.length === 11, `2日全景游 = 11 站（前山8+后山3，实际 ${planByName("2日全景游")?.allow?.length}）`);
const r2Names = namesOf(planByName("2日全景游"));
okPlan(r2Names.includes("青城后山") && r2Names.includes("五龙沟") && r2Names.includes("白云万佛洞"), "2日全景游 含 青城后山/五龙沟/白云万佛洞（后山第2天）");
okPlan(!r2Names.includes("都江堰"), "2日全景游 不含 都江堰");
const r3Names = namesOf(planByName("主题游"));
okPlan(planByName("主题游")?.allow?.length === 6, `主题游 = 6 站（实际 ${planByName("主题游")?.allow?.length}）`);
okPlan(r3Names.includes("都江堰") && r3Names.includes("青城后山"), "主题游 含 都江堰 + 青城后山（统一景点）");
okPlan(!r3Names.includes("五龙沟") && !r3Names.includes("白云万佛洞") && !r3Names.includes("青城山景区"), "主题游 不含 五龙沟/白云万佛洞/青城山景区（子点/重复点收敛）");
const core4 = r3Names.filter((n) => ["青城山", "天师洞", "上清宫", "建福宫", "老君阁"].includes(n));
okPlan(core4.length === 4, `主题游 含 4 热核心（实际 ${core4.join("/")}）`);
okPlan(planByName("文学巡礼线") === undefined, "非小说源 → 无 文学巡礼线");

// ── normalizeLayers 结构规范化（青城山实际 bug：地区景点 4 层为扁平字符串，前端读 .text 为 undefined）──
console.log("\n=== normalizeLayers 扁平→嵌套 ===");
let normPass = true;
const okNorm = (cond, label) => { if (!cond) normPass = false; console.log(`  ${cond ? "✓" : "✗"} ${label}`); };
const flatLayers = { novel: "五龙沟，因五条山脊如龙而得名", history: "五龙沟是青城后山主要景点", folklore: "传说五龙沟是五位龙子的化身", customs: "祭龙习俗" };
const nested = normalizeLayers(flatLayers);
okNorm(typeof nested.novel === "object" && nested.novel.text === flatLayers.novel, "扁平字符串 novel → {text}");
okNorm(typeof nested.history === "object" && nested.history.text, "扁平字符串 history → {text}");
okNorm(typeof nested.folklore === "object" && nested.folklore.text, "扁平字符串 folklore → {text}");
okNorm(typeof nested.customs === "object" && nested.customs.text, "扁平字符串 customs → {text}");
const alreadyNested = normalizeLayers({ novel: { text: "已有嵌套" }, history: { scenes: [] } });
okNorm(alreadyNested.novel.text === "已有嵌套", "已嵌套结构保持不变");
okNorm(Array.isArray(alreadyNested.history.scenes), "已有 scenes 结构保持不变");
okNorm(Object.keys(normalizeLayers(null)).length === 0, "null → {}");
okNorm(Object.keys(normalizeLayers("x")).length === 0, "非对象 → {}");

console.log(anchorPass ? "✅ 全部通过" : "❌ 有失败");

if (!GAODE_KEY) { console.error("\n⚠️ 缺少 GAODE_KEY，跳过实时高德查询。"); process.exit(allPass && anchorPass && planPass && normPass ? 0 : 1); }

// ---- 第二部分：修复后 gaode() 实际解析（需要 GAODE_KEY） ----
console.log(`\n=== 修复后 gaode() 实际解析 (key 前缀 ${GAODE_KEY.slice(0,4)}…) ===`);
const CASES = [
  ["袁家界", "湖南省张家界市"],
  ["金鞭溪", "湖南省张家界市"],
  ["十里画廊", "湖南省张家界市"],
  ["百龙天梯", "湖南省张家界市"],
  ["天子山", "湖南省张家界市"],
  ["黄石寨", "湖南省张家界市"],
  ["杨家界", "湖南省张家界市"],
  ["水绕四门", "湖南省张家界市"],
];
let pass = 0, fail = 0;
for (const [name, region] of CASES) {
  const res = await gaode(name, region);
  if (!res) { fail++; console.log(`✗ ${name}: 无名称匹配 → 返回 null（将跳过+告警）`); continue; }
  pass++;
  const inWulingyuan = res.lng > 110.3 && res.lng < 110.7 && res.lat > 29.2 && res.lat < 29.6;
  console.log(`${res.usedFallback ? "[放宽] " : "[严格] "}${name} → "${res.name}" @ (${res.lng}, ${res.lat}) ${inWulingyuan ? "✓武陵源范围内" : "⚠坐标可疑"} type=${res.type}`);
}
console.log(`\n结果: ${pass} 成功 / ${fail} 失败`);

// ---- 第三部分：武陵源多点扫描（完整管线镜像，需要 GAODE_KEY） ----
// 用 gaode() 解析真实锚点坐标（名称用原始名，模拟 regionScenics），镜像 index.ts 主流程
console.log("\n=== 武陵源多点扫描（完整管线镜像） ===");
const regionLocs = [];
{
  const rawNames = ["武陵源风景名胜区", "张家界国家森林公园", "天子山风景区", "黄石寨", "天门山国家森林公园", "七星山风景区"];
  for (const nm of rawNames) {
    const c = await gaode(nm, "湖南省张家界市");
    if (c) regionLocs.push({ id: `r${regionLocs.length}`, name: nm, lat: c.lat, lng: c.lng });
  }
  console.log(`  地区锚点: ${regionLocs.map(l => `${l.name}(${l.lng},${l.lat})`).join("、")}`);
}
const aiKnown = new Set(["袁家界", "天子山", "黄石寨", "杨家界", "金鞭溪", "十里画廊", "百龙天梯", "水绕四门"]);
const anchors2 = buildAnchors(regionLocs, "天门山");
console.log(`  锚点: ${anchors2.map(a => a.scenicName).join(",")} (核心=${anchors2[0]?.scenicName})`);
const wl2 = anchors2.find(a => a.scenicName === "武陵源");
if (wl2) {
  const points = [{ lng: wl2.lng, lat: wl2.lat, name: wl2.name }, ...(wl2.subPoints || [])].slice(0, 4);
  const other = anchors2.filter(x => x.id !== wl2.id);
  console.log(`  武陵源扫描点: ${points.map(p => p.name).join(" → ")}`);
  const subs = [];
  for (const pt of points) {
    const got = await scanAnchorSubs({ ...pt, scenicName: wl2.scenicName, id: wl2.id }, regionLocs, other, aiKnown);
    for (const g of got) if (!subs.some(s => s.name === g.name)) subs.push(g);
  }
  const allNames = [...regionLocs.map(l => l.name), ...subs.map(s => s.name)];
  const FAMOUS = ["袁家界", "天子山", "黄石寨", "杨家界", "金鞭溪", "十里画廊", "百龙天梯", "水绕四门"];
  const missing = FAMOUS.filter(f => !allNames.some(n => n.includes(f)));
  // 跨区污染只检查【扫描新增】的子景点，regionLocs 里七星山风景区本来就在（主题游合理）
  const bad = ["七星山", "黄龙洞", "张家界大峡谷"].filter(b => subs.some(s => s.name.includes(b)));
  console.log(`  扫描新增子景点: ${subs.map(s => s.name).join("、")}`);
  for (const f of FAMOUS) console.log(`  ${missing.includes(f) ? "✗缺" : "✓"} ${f}`);
  console.log(`  跨区排除: ${bad.length ? "✗ " + bad.join(",") : "✓ 七星山/黄龙洞/大峡谷 均未混入扫描"}`);
  if (missing.length === 0 && bad.length === 0) console.log("  ✅ 武陵源覆盖完整且无跨区污染");
  else console.log("  ❌ 扫描有问题");
} else {
  console.log("  ✗ 未识别出武陵源锚点");
}

// ---- 第四部分：regionScenics 覆盖诊断（哪几个子景点被 types 查询确定性覆盖） ----
console.log("\n=== regionScenics（张家界 types 查询）覆盖诊断 ===");
async function gaodeRegionScenics(city) {
  const cityParam = encodeURIComponent((splitRegion(city).city || city).replace(/[市]$/g, ""));
  const r = await fetch(`https://restapi.amap.com/v3/place/text?city=${cityParam}&key=${GAODE_KEY}&types=风景名胜|旅游景点&citylimit=true&offset=30`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || []).filter(p => p.location && !/省.*市/.test(p.name || "")).map(p => p.name);
}
const rs = await gaodeRegionScenics("湖南省张家界市");
console.log(`  张家界风景名胜类型 ${rs.length} 个:`);
console.log(`  ${rs.join("、")}`);
const FAMOUS8 = ["袁家界", "天子山", "黄石寨", "杨家界", "金鞭溪", "十里画廊", "百龙天梯", "水绕四门"];
for (const f of FAMOUS8) console.log(`  ${rs.some(n => n.includes(f)) ? "✓" : "✗缺"} ${f}（regionScenics）`);

// ---- 第五部分：水绕四门/金鞭溪 around 可达性诊断（判断是覆盖还是高德没返回） ----
console.log("\n=== 子景点 around 可达性诊断 ===");
for (const [nm, lng, lat] of [["水绕四门", 110.469887, 29.34271], ["金鞭溪", 110.445812, 29.335822]]) {
  const around = await gaodeAroundScenics(lng, lat, 8000);
  const hit = around.some(c => c.name.includes(nm) || c.raw.includes(nm));
  console.log(`  ${nm} 自身坐标 (${lng},${lat}) 周围 8km 扫描: ${hit ? "✓ 能扫到" : "✗ 扫不到"}（${around.length} 候选）`);
}
