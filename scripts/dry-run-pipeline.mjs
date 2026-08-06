// 完整管线 dry-run：镜像 supabase/functions/process-tour/index.ts 主流程（不写库），支持 v69/v70 双模式 A/B。
// 用法: node scripts/dry-run-pipeline.mjs --dest 嵩山 --region 河南登封 --mode v69
// 密钥: GAODE_KEY / DEEPSEEK_API_KEY 来自进程环境或项目 .env（.env 已 gitignore）
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ── 参数 ──
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] || ""]);
  return acc;
}, []));
const DEST = args.dest || "嵩山";
const REGION = args.region || "河南登封";
const MODE = args.mode || "v70"; // v69=线上现状镜像  v70=修复版
const SRC = args.source && existsSync(args.source) ? readFileSync(args.source, "utf8") : "";
console.log(`▶ dry-run [${MODE}] 目的地=${DEST} 地区=${REGION} 源文本=${SRC.length}字`);

// ── 密钥 ──
function loadEnvKey(name, fallbackRe) {
  if (process.env[name]) return process.env[name];
  const envPath = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^${name}=(.+)$`, "m"));
    if (m) return m[1].trim();
  }
  if (fallbackRe) {
    const backup = join(homedir(), "session-backup-9d6c4422.jsonl");
    if (existsSync(backup)) {
      const m = readFileSync(backup, "utf8").match(fallbackRe);
      if (m) return m[0];
    }
  }
  return "";
}
const GAODE_KEY = loadEnvKey("GAODE_KEY", /2ff1[a-f0-9]{28}/);
const DEEPSEEK_KEY = loadEnvKey("DEEPSEEK_API_KEY");
if (!GAODE_KEY || !DEEPSEEK_KEY) { console.error("缺少 GAODE_KEY 或 DEEPSEEK_API_KEY"); process.exit(1); }

// ── 常量（与 index.ts 一致）──
const SUB_AREA_RADIUS = 12000, SCAN_RADIUS = 12000, ANCHOR_CAP = 12, SUB_TOTAL_CAP = 10;
const SUB_DEDUP_M = 300, REGION_RADIUS = 60000, DEDUP_M = 150, CLUSTER_R = 8000, UMBRELLA_ABSORB_M = 12000;
const CONTENT_CHUNK = MODE === "v70" ? 5 : 8;                 // P0-3: 8→5 防 max_tokens 截断
const DS_TIMEOUT = MODE === "v70" ? 60000 : 120000;           // P0-2: worker 预算内
const DS_RETRIES = 2;
const CONTENT_CONC = MODE === "v70" ? 3 : 4;                  // P0-2: 降并发防 429
const EXTRACT_TEMP = MODE === "v70" ? 0.2 : 0.7;              // P2: 提取/路线求稳定

const FACILITY_RE = /停车场|售票处|售票点|售票大厅|检票口|检票|门票站|乘车处|候车(?:处|亭|室)|索道(?:上站|下站|中站|入口|出口|站)?$|缆车$|观光车(?:站|场|停靠点)|游客中心|游客服务(?:点|中心)?|服务区|服务站|服务中心|管理处|管委会|委员会|居委会|村委会|派出所|加油站|银行|超市|商店|小卖部|商业街|饭店|餐厅|宾馆|酒店|客栈|民宿|山庄|农家乐|厕所|卫生间|洗手间|公厕|入口$|出口$|北门|南门|东门|西门|中门|大门|广场$|车站$|码头$|步道$|栈道$|观景台$|平台$|通道|门店|店\)|店$|综合服务|街道|步行街|(?<!故)居$|邮政|快递|营业厅|窗口|咨询|摄影|团队|散客|办事处|招商中心|营销中心|售楼处|工会|党员|人社|村委会/;
const JUNK_RE = /咖啡|餐厅|奶茶|小吃|甜品|麦当劳|瑞幸|肯德基|烧仙草|汉堡|客栈|民宿|山庄|农家乐|火锅|三下锅|菜馆|私房菜|家常菜|中餐馆|餐馆|乡厨|烧烤|快餐|美食|门店|服务社|宾馆|酒店|超市|银行|加油站|KTV|健身房|旅行社|蜜雪|面包|饮品|烘焙|酸奶|烤面包|速递|快递/;
// 现代商业游乐设施（地区合并专用负向过滤：二七广场/方特/动物王国/海洋馆类）
const AMUSE_RE = /动物王国|游乐园|欢乐谷|主题乐园|海洋馆|海洋公园|海昌|电影小镇|戏剧幻城|水上乐园|欢乐世界|方特|万达城|融创|游乐场|马戏|欢乐田园|迪士尼|欢乐海岸|梦幻王国|魔幻|乐园/;
const ATTRACTION_RE = /景|峰|峡|桥|梯|画廊|溪|界|寨|洞|寺|观|湖|湾|山|岭|谷|岩|石|门|瀑|泉|亭|阁|殿|庙|祠|塔|墓|园|池|林|松|海|台|田|索道|温泉|漂流|故居|书院/;

// ── Region helpers（与 index.ts 一致）──
const PROV_PREFIX = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/;
const PROV_EXACT = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
function splitRegion(t) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  const m = t.match(PROV_PREFIX);
  if (m && m[0].length < t.length) return { prov: m[0], city: t.slice(m[0].length) };
  return { prov: "", city: t };
}
const stripSuffix = (s) => String(s).replace(/[市]$/g, "");

// P0-1: v70 的 regionMatch 增加 district 候选（县级市/区县写法，如"河南登封""河南省登封市"）
function regionMatch(geo, targetRegion) {
  if (!geo) return false;
  const norm = String(targetRegion).trim();
  if (!norm) return false;
  const gProv = String(geo.province || "");
  const gCity = Array.isArray(geo.city) ? (geo.city[0] || "") : String(geo.city || "");
  const gCityCand = gCity || gProv;
  const gDistrict = MODE === "v70" ? String(geo.district || "") : ""; // ← v70 关键差异
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
  const gCityN = gCityCand.replace(/[市]$/g, "");
  if (gCityN && norm.includes(gCityN)) return true;
  const gDistN = gDistrict.replace(/[市区县]$/g, "");
  if (MODE === "v70" && gDistN && norm.includes(gDistN)) return true; // 裸县级市写法
  if (norm.length <= 3) {
    const gProvN = gProv.replace(/省$/, "");
    return gProv.includes(norm) || (gProvN && norm.includes(gProvN));
  }
  return false;
}

const EARTH_R = 6371000;
function haversineM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

// ── DeepSeek ──
// v69: 仅 JSON 解析失败重试；HTTP 错误/空内容/超时直接 throw（线上现状）
// v70: 全类型失败重试 + 指数退避；finish_reason=length 上抛特殊错误供 chunk 拆半
class TruncatedError extends Error { constructor() { super("finish_reason=length"); this.truncated = true; } }
async function deepseek(messages, { retries = DS_RETRIES, temperature = 0.7, maxTokens = 8192 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", { signal: AbortSignal.timeout(DS_TIMEOUT),
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({ model: "deepseek-chat", messages, temperature, max_tokens: maxTokens, response_format: { type: "json_object" } }),
      });
      if (!r.ok) throw new Error(`DeepSeek: ${r.status}`);
      const j = await r.json();
      const choice = j.choices?.[0];
      const text = (choice?.message?.content || "").trim();
      if (!text) throw new Error("DeepSeek 返回空内容");
      if (MODE === "v70" && choice?.finish_reason === "length") throw new TruncatedError();
      const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
      return JSON.parse(cleaned);
    } catch (e) {
      lastErr = e;
      if (e.truncated) throw e; // 截断：交给上层拆半，不盲目重试
      if (MODE === "v69") {
        // 线上行为：仅 JSON 解析失败重试，其余直接抛
        if (!(e instanceof SyntaxError)) throw e;
        if (attempt < retries) continue;
        throw new Error(`DeepSeek JSON 解析失败: ${e.message}`);
      }
      // v70：所有失败统一退避重试
      if (attempt < retries) { await new Promise(r2 => setTimeout(r2, [1000, 3000, 8000][attempt] || 8000)); continue; }
      throw e;
    }
  }
  throw lastErr || new Error("DeepSeek 调用失败");
}

// ── 高德（与 index.ts 一致）──
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
  const query = async (types, useCity = true) => {
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
    const cityParam = useCity ? cityPart : "";
    // P1-8(v70)：并发下 CUQPS 限流高频出现，2 次 300ms 重试不够 → 4 次指数退避（随机丢点的主因）
    const maxAttempt = MODE === "v70" ? 4 : 2;
    for (let attempt = 0; attempt < maxAttempt; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}${cityParam}&key=${GAODE_KEY}${typesParam}${biasParam}`, { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise((r2) => setTimeout(r2, [300, 800, 1500, 2500][attempt] || 2500)); continue; }
      return (d.pois || []).filter((p) => !/省.*市/.test(p.name || ""));
    }
    return [];
  };
  let matched = overlaps(await query("风景名胜|旅游景点"));
  if (!matched.length) matched = overlaps(await query(null));
  // P1-4(v70)：city 是县级名（如"登封"）时高德召回极差 → 去掉 city 靠 location 偏置重查，
  // 下游 regeo/regionMatch 仍会把关（中岳庙/法王寺/太室阙在 city=登封 下召回为空，去掉 city 即命中）
  if (MODE === "v70" && !matched.length && cityPart) {
    matched = overlaps(await query("风景名胜|旅游景点", false));
    if (!matched.length) matched = overlaps(await query(null, false));
  }
  if (!matched.length) return null;
  const top = preferScenic(matched)[0];
  const [lng, lat] = top.location.split(",").map(Number);
  return { lng, lat, name: cleanName(top.name) };
}
function cleanName(n) {
  let c = n.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === c) break;
    c = next;
  }
  return c || n;
}
async function gaodeRegionScenics(city, bias) {
  const rawCity = (splitRegion(city).city || city).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `city=${encodeURIComponent(rawCity)}&citylimit=true&`;
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const r = await fetch(`https://restapi.amap.com/v3/place/text?${cityPart}key=${GAODE_KEY}&types=${encodeURIComponent("风景名胜|旅游景点")}&offset=30${biasParam}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p) => p.location && !/省.*市/.test(p.name || ""))
    // P1-3: v70 负向过滤商业游乐/设施（杀 二七广场/方特/海洋馆/车站），不做正向字符过滤
    // —— 正向过滤会误杀"都江堰/灌县古城/街子古镇"等无景点特征字的真名胜
    .filter((p) => MODE === "v69" || (!AMUSE_RE.test(p.name || "") && !JUNK_RE.test(p.name || "") && !FACILITY_RE.test(p.name || "")))
    .map((p) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: p.name }; });
}
async function gaodeAroundScenics(lng, lat, radius = SCAN_RADIUS) {
  const fetchPage = async (page) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=${radius}&offset=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise((r2) => setTimeout(r2, attempt === 0 ? 300 : 800)); continue; }
      return (d.pois || [])
        .filter((p) => p.location && !/省.*市/.test(p.name || "") && !JUNK_RE.test(p.name || "") && ATTRACTION_RE.test(p.name || ""))
        .map((p) => { const [lng2, lat2] = p.location.split(",").map(Number); return { lng: lng2, lat: lat2, name: cleanName(p.name), raw: p.name }; });
    }
    return [];
  };
  const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
  const seen = new Set();
  return [...p1, ...p2, ...p3].filter((c) => { const k = `${c.lng},${c.lat}|${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
async function regeo(lng, lat) {
  try {
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${GAODE_KEY}`, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) return undefined;
    const d = await r.json();
    if (d.status === "1" && d.regeocode?.addressComponent) {
      const ac = d.regeocode.addressComponent;
      return { province: ac.province, city: ac.city, district: ac.district, adcode: ac.adcode };
    }
    return null;
  } catch { return undefined; }
}

// ── 锚点 / 子景点（与 index.ts 一致）──
// 是否为景区锚点：核心景区名匹配，或名称以景区设计词结尾且非"XX-子点"（排除"天门山国家森林公园-天门洞"）
// P1-5(v70)：destName 子串匹配必须同时满足「等于目的地」或「以景区设计词结尾」——否则
// "中国嵩山卢崖瀑布/嵩山世界地质公园科普广场/嵩山景区峻极峰"这类含目的地名的普通 POI 全成锚点，
// 景区归属被打碎 → corePool 只剩 1 点 → 1日精华游只有 1 站。
function isScenicAnchor(loc, destName) {
  const n = String(loc.name || "");
  if (/-/.test(n)) return false; // "XX景区-子点"（如天门山国家森林公园-天门洞）是子点，不是锚点
  const hasSuffix = /(风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|公园)$/.test(n);
  if (destName) {
    if (MODE === "v70") {
      if (n === destName || destName.includes(n)) return true;
      if (n.includes(destName) && hasSuffix) return true;
      if (n.startsWith(destName.slice(0, 2)) && /(后山|前山|西线|东线|南线|北线|北坡|南坡|西坡|东坡)(景区|风景区)?$/.test(n)) return true; // v70.2 卫星景区锚点
    } else {
      if (n.includes(destName) || destName.includes(n)) return true;
    }
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
    if (rank > 1) continue;
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

// ── 路线规划（planRoutes 与 index.ts 一致；P2: v70 mainPool 逐点过滤）──
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
  const coreCenter = corePool.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
  const coreN = corePool.length || 1;
  const cc = { lng: coreCenter.lng / coreN, lat: coreCenter.lat / coreN };
  const nearCore = (l, maxM) => haversineM(cc, l) <= maxM;
  // P2: v69 全有或全无（一个远点团灭整个后山池）；v70 逐点过滤
  if (MODE === "v69") { if (mainPool.length && !mainPool.every((l) => nearCore(l, 25000))) mainPool = []; }
  else { mainPool = mainPool.filter((l) => nearCore(l, 35000)); } // v70.1: 25→35km 覆盖天门山↔武陵源32km
  const unifiedRegion30 = clusterRegionPts(locs, corePool).map((c) => pickRep(c, ctx.destName)).filter((l) => nearCore(l, 40000)); // v70.1: 30→40km
  const plans = [];
  if (corePool.length) plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: corePool.slice(0, 8).map((l) => l.id) });
  if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...corePool.slice(0, 8).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  } else if (corePool.length >= 8) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: corePool.slice(0, 14).map((l) => l.id) });
  }
  if (ctx.hasRegionTour && unifiedRegion30.length) {
    plans.push({ label: "主题游", title: `${ctx.destName}深度主题游`, allow: [...corePool.slice(0, 4).map((l) => l.id), ...unifiedRegion30.map((l) => l.id)] });
  }
  if (ctx.isNovelBased) plans.push({ label: "文学巡礼线", title: `《${ctx.novelName}》文学巡礼`, allow: null });
  return plans;
}
function pruneFarPoints(cands) {
  if (cands.length <= 2) return cands;
  const med = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  let pts = cands;
  for (let round = 0; round < 3; round++) {
    const c = { lng: med(pts.map(p => p.lng)), lat: med(pts.map(p => p.lat)) };
    const next = pts.filter(p => haversineM(c, p) <= 20000);
    if (next.length < 2 || next.length === pts.length) break;
    pts = next;
  }
  // P1-7(v70)：簇感知恢复——被剔点若自身聚成 ≥2 点的簇（如天门山+天门洞，距武陵源 35km），
  // 是真实独立景区而非幻觉点 → 恢复；只有孤立远点才真剔除
  if (MODE === "v70" && pts.length < cands.length) {
    const removed = cands.filter(p => !pts.includes(p));
    const clusters = [];
    for (const p of removed) {
      const c = clusters.find(c => haversineM(c.rep, p) < CLUSTER_R);
      if (c) c.locs.push(p);
      else clusters.push({ rep: p, locs: [p] });
    }
    for (const c of clusters) if (c.locs.length >= 2) pts = [...pts, ...c.locs];
  }
  return pts;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// ═══════════════════ 主流程（镜像 Deno.serve 主体，不写库） ═══════════════════
const t0 = Date.now();
const warnings = [];
const report = { mode: MODE, dest: DEST, region: REGION };
try {
  // 目的地坐标偏置
  const destLoc = DEST ? await gaode(DEST, REGION).catch(() => null) : null;
  console.log(`目的地偏置: ${destLoc ? `(${destLoc.lng},${destLoc.lat}) ${destLoc.name}` : "null"}`);

  // 地区准备并行启动（AI 提议 + regionScenics）
  let hasRegionTour = false;
  let aiAttractions = [];
  const regionPrep = REGION ? (async () => {
    const regionScenics = await gaodeRegionScenics(REGION, destLoc || undefined).catch(() => []);
    let aiFromPrep = [];
    try {
      const rr2 = await deepseek([
        { role: "system", content: "你是中国旅游专家。只返回JSON。" },
        { role: "user", content: `目的地：${DEST}（${REGION}）。列出该地区除\"${DEST}\"自身外、最值得一游的著名独立景点，以及 ${DEST} 所在知名景区的著名子景点。只列真实存在、广为人知的著名景点。**若该知名景区有多个广为人知的著名子景点，必须全部列出、一个都不能漏，不要只挑最出名的几个**。独立景点也一并列出。8-15 个，宁多勿漏。JSON: {\"attractions\":[\"名称1\",\"名称2\"]}` },
      ], { temperature: EXTRACT_TEMP });
      aiFromPrep = (rr2.attractions || []).map(String).filter(Boolean);
    } catch (e) { console.log(`  (regionPrep AI 提议失败: ${e.message})`); }
    return { regionScenics, aiAttractions: aiFromPrep };
  })() : Promise.resolve({ regionScenics: [], aiAttractions: [] });

  // 1. 提取地点
  const lr = await deepseek([
    { role: "system", content: "你是中国旅游规划专家。只返回JSON。只提取真实存在的地点，不确定的地点不要提取。只列固定旅游景点/地标/古迹/公园/山峰/宫观，不要临时展览、活动、演出、商业店铺等非固定地点。" },
    { role: "user", content: `目的地：${DEST}（${REGION}）\n文本：${SRC.slice(0, MODE === "v70" ? 12000 : 6000)}\n\n提取目的地自身值得探访的地点：有文本时以文本提到的地点为准；文本为空时列出目的地自身及紧邻的真实名胜（山峰、宫观、栈道、园区、古迹等）。至少提取 8-12 个（景点多可更多）。宁可多列，坐标校验会过滤掉不存在的——不要遗漏真实景点。\nJSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
  ], { temperature: EXTRACT_TEMP });
  console.log(`AI 提取 ${(lr.locations || []).length} 个候选: ${(lr.locations || []).map(l => l.name).join("、")}`);

  // 2. 坐标校验（P1-8: v70 并发 6→4，配合限流退避，减少 CUQPS 随机丢点）
  const locs = [];
  const extract = await mapLimit(lr.locations || [], MODE === "v70" ? 4 : 6, async (l) => {
    const c = await gaode(l.name, REGION, destLoc || undefined);
    if (!c || !c.lat) return { warn: `⚠️ "${l.name}" 未找到坐标，已跳过`, loc: null };
    const geo = await regeo(c.lng, c.lat);
    if (geo === undefined) return { warn: `⚠️ "${l.name}" 坐标校验失败（高德 API 不可达），已跳过`, loc: null };
    if (geo === null) return { warn: `⚠️ "${l.name}" 坐标无法解析，已跳过`, loc: null };
    if (!regionMatch(geo, REGION)) return { warn: `⚠️ "${l.name}" 位于 ${geo.province}${Array.isArray(geo.city) ? geo.city[0] || "" : geo.city || ""}${geo.district || ""}，不在 ${REGION}，已跳过`, loc: null };
    const displayName = c.name && c.name !== l.name ? c.name : l.name;
    return { warn: null, loc: { id: l.id, name: displayName, lat: c.lat, lng: c.lng, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [] } };
  });
  for (const r of extract) {
    if (r.warn) warnings.push(r.warn);
    if (r.loc) { r.loc.sort_order = locs.length; locs.push(r.loc); }
  }
  if (locs.length === 0) throw new Error("未识别出任何有效地点：AI 提议名单全部被地区坐标校验拒绝（请检查目的地地区是否为规范省/市名）。");
  if (MODE === "v70" && locs.length < 3) throw new Error(`仅识别出 ${locs.length} 个有效地点，不足以生成导览（请检查目的地地区填写，或补充源文本）。`);

  // 离群点剔除 + 坐标去重
  const clusterKeep = new Set(pruneFarPoints(locs));
  if (clusterKeep.size < locs.length) {
    for (const l of locs) if (!clusterKeep.has(l)) warnings.push(`⚠️ "${l.name}" 距其他地点过远（离群点），已剔除`);
    locs.length = 0; locs.push(...clusterKeep);
  }
  const deduped = [];
  for (const l of locs) {
    const dup = deduped.find(d => haversineM(d, l) < DEDUP_M);
    if (dup) {
      if ((l.importance || 3) > (dup.importance || 3)) deduped[deduped.indexOf(dup)] = l;
      warnings.push(`♻️ "${l.name}" 与 "${dup.name}" 距离过近(<${DEDUP_M}m)，已去重`);
      continue;
    }
    deduped.push(l);
  }
  deduped.forEach((l, i) => (l.sort_order = i));
  locs.length = 0; locs.push(...deduped);
  console.log(`坐标校验后 ${locs.length} 个: ${locs.map(l => l.name).join("、")}`);

  // 3. 地区景点合并
  if (REGION && locs.length >= 3) {
    try {
      const { regionScenics, aiAttractions: aiPrep } = await regionPrep;
      aiAttractions = aiPrep;
      const nameSeen = new Set();
      const regionFinal = [];
      const aiPts = await mapLimit(aiAttractions.filter(n => !nameSeen.has(n)), 5, async (name) => {
        const c = await gaode(name, REGION, destLoc || undefined);
        if (!c || !c.lat) return null;
        // P1-9(v70)：AI 提议点也要过设施/餐饮/游乐过滤——否则"老院子饭庄(永定大道)"
        // "普光禅寺(公交站)"这类解析结果会直接并入导览
        if (MODE === "v70" && (FACILITY_RE.test(c.name) || JUNK_RE.test(c.name) || AMUSE_RE.test(c.name) || /饭庄|公交站|地铁站/.test(c.name))) return null;
        if (locs.some(l => haversineM(l, c) < 5000)) return null;
        return { lng: c.lng, lat: c.lat, name: c.name || name };
      });
      for (const p of aiPts) {
        if (!p) continue;
        if (nameSeen.has(p.name)) continue;
        if (regionFinal.some(q => haversineM(q, p) < 1000)) continue;
        nameSeen.add(p.name);
        regionFinal.push(p);
      }
      for (const p of regionScenics) {
        if (regionFinal.some(q => haversineM(q, p) < 1000)) continue;
        if (nameSeen.has(p.name)) continue;
        if (locs.some(l => String(l.name) === p.name)) continue;
        nameSeen.add(p.name);
        regionFinal.push(p);
      }
      const coreCenter = locs.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
      const center = { lng: coreCenter.lng / locs.length, lat: coreCenter.lat / locs.length };
      const near = regionFinal.filter(p => haversineM(center, p) <= REGION_RADIUS);
      regionFinal.length = 0; regionFinal.push(...near);
      if (regionFinal.length >= 3) {
        // P1-3: v70 cap 20→12，importance 4→3
        // P1-6(v70)：名称含目的地名的点（"嵩山国家重点风景名胜区""中国·嵩山世界地质公园"）
        // 是目的地自身/别名，并入会作为"地区景点"混进主题游 → 剔除
        const final = (MODE === "v70"
          ? regionFinal.filter(p => !(DEST && (p.name.includes(DEST) || DEST.includes(p.name))))
          : regionFinal);
        if (MODE === "v70" && final.length < 3) { console.log("  (地区点剔除目的地别名后 <3，不并入)"); }
        else {
        const cap = MODE === "v70" ? 12 : 20;
        const imp = MODE === "v70" ? 3 : 4;
        const addN = Math.min(cap, final.length);
        for (const p of final.slice(0, addN)) {
          locs.push({ id: `reg-${locs.length}`, name: p.name, lat: p.lat, lng: p.lng, elevation: "", importance: imp, tags: ["地区景点"], layers: {}, reflection: "", practical: {} });
        }
        locs.forEach((l, i) => (l.sort_order = i));
        hasRegionTour = true;
        warnings.push(`🌏 自动并入 ${addN} 个地区知名景点（可组主题游）`);
        console.log(`地区合并 +${addN}: ${final.slice(0, addN).map(p => p.name).join("、")}`);
        }
      }
    } catch (e) { console.log(`  (地区合并失败不阻断: ${e.message})`); }
  }

  // 4. 子景点扫描 + 景区归属
  const anchors = buildAnchors(locs, DEST);
  try {
    const scanAnchors = anchors.filter(a => a.weight >= 4 && !(DEST && a.scenicName.includes(DEST)));
    const aiKnown = new Set(aiAttractions);
    const subs = [];
    for (const a of scanAnchors.slice(0, 3)) {
      const points = [{ lng: a.lng, lat: a.lat, name: a.name }, ...(a.subPoints || [])].slice(0, 4);
      for (const pt of points) {
        try {
          const got = await scanAnchorSubs({ ...pt, scenicName: a.scenicName, id: a.id }, locs, anchors.filter(x => x.id !== a.id), aiKnown);
          for (const g of got) {
            if (subs.some(s => s.name === g.name || haversineM(s, g) < SUB_DEDUP_M)) continue;
            subs.push(g);
          }
        } catch (e) { /* 单点失败不阻断 */ }
        if (subs.length >= SUB_TOTAL_CAP) break;
      }
      if (subs.length >= SUB_TOTAL_CAP) break;
    }
    const subsCapped = subs.slice(0, SUB_TOTAL_CAP).map((s, i) => ({ ...s, id: `sub-${locs.length + i}` }));
    for (const s of subsCapped) locs.push(s);
    locs.forEach((l, i) => (l.sort_order = i));
    attachScenicTags(locs, anchors);
    if (subsCapped.length) { warnings.push(`🗺 子景点确定性补全 +${subsCapped.length} 个`); console.log(`子景点补全 +${subsCapped.length}: ${subsCapped.map(s => s.name).join("、")}`); }
  } catch (e) { /* 不阻断 */ }

  // 核心/主景区
  const coreAnchor = anchors.find(a => DEST && (a.name === DEST || a.scenicName === DEST))
    || anchors.find(a => DEST && (a.name.includes(DEST) || DEST.includes(a.name)))
    || anchors[0] || null;
  const coreScenicName = coreAnchor?.scenicName || (DEST || "");
  const countByScenic = new Map();
  for (const l of locs) if (l.scenic && l.scenic !== coreScenicName && l.scenic !== "独立") countByScenic.set(l.scenic, (countByScenic.get(l.scenic) || 0) + 1);
  let mainScenicName = "", maxC = -1;
  for (const [k, v] of countByScenic) if (v > maxC) { maxC = v; mainScenicName = k; }
  if (maxC < 2) mainScenicName = "";
  console.log(`核心景区=${coreScenicName} 主景区=${mainScenicName || "(无)"} 锚点=${anchors.map(a => a.scenicName).join(",")}`);

  const slugToDbId = new Map(locs.map(l => [l.id, l.id])); // dry-run 不需要 tourId 命名空间
  const resolveStop = (s) => {
    const key = String(s).trim();
    if (!key) return undefined;
    if (slugToDbId.has(key)) return slugToDbId.get(key);
    const hit = locs.find(l => l.name === key || key.includes(l.name) || l.name.includes(key));
    return hit ? slugToDbId.get(hit.id) : undefined;
  };

  const plans = planRoutes(locs, { coreScenicName, mainScenicName, destName: DEST, isNovelBased: !!args.novel, novelName: args.novel || "", hasRegionTour });
  const planText = plans.map((p, i) => {
    const stopsTxt = p.allow ? p.allow.map(id => { const l = locs.find(x => x.id === id); return l ? `${id}: ${l.name}` : id; }).join(", ") : "（文学巡礼线：自由选点）";
    return `${i + 1}. ${p.label}「${p.title}」 — 指定站点: ${stopsTxt}`;
  }).join("\n");

  // 5. 内容与路线并行
  const genContent = async () => {
    const contentById = new Map();
    const chunks = [];
    for (let ci = 0; ci < locs.length; ci += CONTENT_CHUNK) chunks.push(locs.slice(ci, ci + CONTENT_CHUNK));
    const promptFor = (chunk) => [
      { role: "system", content: "你是文学旅游内容创作者。只返回JSON。" },
      { role: "user", content: `四层内容（📖文学意境/🏛历史掌故/🐉民间传说/🎭地域文化）。\n${chunk.map(l => `- ${l.id}: ${l.name}`).join("\n")}\n参考: ${SRC.slice(0, MODE === "v70" ? 6000 : 4000)}\n\n每层${MODE === "v70" ? "120-180" : "150-250"}字。id 必须逐字复制上面给定的 id。JSON: {"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
    ];
    const runChunk = async (chunk) => {
      try {
        const cr = await deepseek(promptFor(chunk));
        return cr.locations || [];
      } catch (e) {
        if (MODE === "v69") throw e; // 线上：一个 chunk 炸全链路炸
        // v70: 截断→拆半重试；其他错误→单点重试；仍失败→记 warning 不阻断
        if (e.truncated && chunk.length > 1) {
          const mid = Math.ceil(chunk.length / 2);
          const [a, b] = await Promise.all([runChunk(chunk.slice(0, mid)), runChunk(chunk.slice(mid))]);
          return [...a, ...b];
        }
        warnings.push(`⚠️ 内容批次（${chunk.map(l => l.name).join("/")}）生成失败：${e.message}，尝试单点补生成`);
        const single = await mapLimit(chunk, 3, async (l) => {
          try {
            const cr = await deepseek(promptFor([l]));
            return (cr.locations || [])[0] || null;
          } catch (e2) { warnings.push(`⚠️ "${l.name}" 内容补生成失败：${e2.message}`); return null; }
        });
        return single.filter(Boolean);
      }
    };
    const chunkResults = await mapLimit(chunks, CONTENT_CONC, runChunk);
    for (const cds of chunkResults) for (const cd of cds) if (cd?.id) contentById.set(cd.id, cd);
    // P1-2: v70 按名兜底匹配（AI 没逐字复制 id 时）
    if (MODE === "v70") {
      for (const cd of [...contentById.values()]) {
        if (locs.some(l => l.id === cd.id)) continue;
        const hit = locs.find(l => l.name === cd.id || String(cd.id).includes(l.name) || l.name.includes(String(cd.id)));
        if (hit && !contentById.has(hit.id)) { contentById.set(hit.id, cd); warnings.push(`♻️ 内容 id"${cd.id}" 按名匹配到 "${hit.name}"`); }
      }
      // 完整性检查 + 单点补生成
      const missing = locs.filter(l => !contentById.has(l.id));
      if (missing.length) {
        warnings.push(`⚠️ ${missing.length} 个地点内容缺失，单点补生成: ${missing.map(l => l.name).join("/")}`);
        const filled = await mapLimit(missing, 3, async (l) => {
          try { const cr = await deepseek(promptFor([l])); return ((cr.locations || [])[0]) || null; }
          catch (e) { warnings.push(`⚠️ "${l.name}" 内容最终缺失：${e.message}`); return null; }
        });
        for (const cd of filled) if (cd?.id) {
          const hit = locs.find(l => l.id === cd.id || l.name === cd.id);
          if (hit) contentById.set(hit.id, cd);
        }
      }
    }
    return contentById;
  };

  const genRoutes = async () => {
    let routes = [];
    for (let attempt = 0; attempt < 2 && routes.length < plans.length; attempt++) {
      const rr = await deepseek([
        { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
        { role: "user", content: `${DEST}路线。**每条路线的站点已由系统指定，stops 必须恰好包含这些 id（可调整顺序使行走合理），严禁增删替换；文学巡礼线除外（可自由选点）。**\n\n${planText}\n\n要求：\n1. 每条路线按上面的指定站点生成完整行程（从入口/索道进 → 逐点游览 → 出口/索道出）。\n2. narrative 各写 150-300 字完整行程描述。narrative 中必须写地点的中文名，严禁写 id 代号。\n3. **2日全景游 narrative 必须明确「第1天前山」「第2天后山」各去哪**；主题游写明主题与串联逻辑。\n4. day_label 必须是上面给定的标签。\n5. 地点少时压缩天数，严禁编造不存在的多日行程。\n6. stops 数组顺序必须与 narrative 中的实际游览顺序一致；stops 只能从上面指定 id 中逐字复制。\n7. 路线条数必须与上述完全一致（${plans.length} 条），缺一不可。\nJSON: {"routes":[{"day_label":"","title":"","stops":["id1","id2"],"narrative":"完整行程描述"}]}` },
      ], { temperature: EXTRACT_TEMP });
      const aiRoutes = rr.routes || [];
      const allRoutes = plans.map((plan, i) => {
        const ai = aiRoutes.find((x) => {
          const lbl = String(x?.day_label || "").trim();
          return lbl && (lbl.includes(plan.label) || plan.label.includes(lbl));
        }) || aiRoutes[i] || {};
        const rawStops = (Array.isArray(ai.stops) ? ai.stops : [])
          .map((s) => s && typeof s === "object" ? (s.poi ?? s.id ?? s.name) : s)
          .filter(Boolean);
        const resolved = rawStops.map((s) => resolveStop(s)).filter(Boolean);
        let stops = [];
        if (plan.allow) {
          const allowDb = plan.allow.map(id => slugToDbId.get(id)).filter(Boolean);
          const allowSet = new Set(allowDb);
          const keep = resolved.filter(s => allowSet.has(s));
          const missing = allowDb.filter(id => !keep.includes(id));
          stops = [...keep, ...missing].filter((s, j, arr) => arr.indexOf(s) === j); // v70.2 stops 去重
        } else {
          stops = resolved;
          if (!stops.length) { // v70.3 文学巡礼线回退核心4站
            const fb = locs.filter(l => !(l.tags || []).includes("地区景点")).slice().sort((a, b) => (b.importance || 3) - (a.importance || 3)).slice(0, 4);
            stops = fb.map(l => slugToDbId.get(l.id)).filter(Boolean);
          }
        }
        return { id: `r${i + 1}`, day_label: plan.label, title: plan.title, stops, narrative: typeof ai.narrative === "string" ? ai.narrative : "", sort_order: i, _free: !plan.allow };
      }).filter(r => r.stops.length > 0);
      const seenKeys = new Set();
      const dedupedRoutes = [];
      for (const r of allRoutes) {
        if (r._free) { dedupedRoutes.push(r); continue; } // v70.4
        const key = [...r.stops].sort().join("|");
        if (!seenKeys.has(key)) { seenKeys.add(key); dedupedRoutes.push(r); }
      }
      routes = dedupedRoutes;
    }
    return routes;
  };

  const [contentById, routes] = await Promise.all([genContent(), genRoutes()]);

  for (const l of locs) {
    const cd = contentById.get(l.id) || {};
    l.layers = normalizeLayers(cd.layers);
    l.reflection = cd.reflection || ""; l.practical = cd.practical || {};
  }

  // ═══ 报告 ═══
  const LAYER_KEYS = ["novel", "history", "folklore", "customs"];
  const layerCount = (l) => LAYER_KEYS.filter(k => l.layers?.[k]?.text).length;
  const fullContent = locs.filter(l => layerCount(l) === 4).length;
  const partial = locs.filter(l => layerCount(l) > 0 && layerCount(l) < 4);
  const empty = locs.filter(l => layerCount(l) === 0);
  report.locations = locs.length;
  report.routes = routes.length;
  report.content = { full: fullContent, partial: partial.map(l => `${l.name}(${layerCount(l)}/4)`), empty: empty.map(l => l.name) };
  report.warnings = warnings;
  report.durationSec = Math.round((Date.now() - t0) / 1000);

  console.log(`\n════════ 结果 [${MODE}] ${DEST}（${REGION}）════════`);
  console.log(`✅ 成功 · ${locs.length} 地点 / ${routes.length} 路线 / 耗时 ${report.durationSec}s`);
  console.log(`\n四层内容完整: ${fullContent}/${locs.length}`);
  if (partial.length) console.log(`部分缺失: ${partial.map(l => `${l.name}(${layerCount(l)}/4)`).join("、")}`);
  if (empty.length) console.log(`全部缺失: ${empty.map(l => l.name).join("、")}`);
  console.log(`\n路线:`);
  for (const r of routes) {
    const names = r.stops.map(id => locs.find(l => l.id === id)?.name || id);
    console.log(`  ${r.day_label}「${r.title}」${r.stops.length}站: ${names.join(" → ")}`);
    if (r.narrative) console.log(`    narrative: ${r.narrative.slice(0, 120)}${r.narrative.length > 120 ? "…" : ""}`);
  }
  console.log(`\n地点明细:`);
  for (const l of locs) console.log(`  [${layerCount(l)}/4] ${l.name}  scenic=${l.scenic || "-"} tags=${(l.tags || []).join(",")}`);
  if (warnings.length) { console.log(`\n告警 ${warnings.length} 条:`); for (const w of warnings) console.log(`  ${w}`); }
} catch (e) {
  report.error = e.message;
  report.durationSec = Math.round((Date.now() - t0) / 1000);
  console.log(`\n════════ 结果 [${MODE}] ${DEST}（${REGION}）════════`);
  console.log(`🔴 失败（线上即 status=error）: ${e.message}`);
  if (warnings.length) { console.log(`告警:`); for (const w of warnings) console.log(`  ${w}`); }
  report.warnings = warnings;
  process.exitCode = 2;
}
mkdirSync(fileURLToPath(new URL("./out", import.meta.url)), { recursive: true });
const outFile = fileURLToPath(new URL(`./out/${DEST}-${MODE}.json`, import.meta.url));
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(`\n报告已写入 ${outFile}`);
