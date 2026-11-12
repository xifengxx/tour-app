// B 层验证：高德结构化 POI 检索 vs 现有导览地点清单
// 用法：
//   node scripts/probe-structured-poi.mjs --dest 庐山 --region 江西省九江市 --radius 12000
//   node scripts/probe-structured-poi.mjs --dest 庐山 --region 江西省九江市 --compare src/data/story/lushan.json
// 说明：只读，不写库。用 .env 里的 GAODE_KEY（Web 服务 key）。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPool } from "../src/lib/poiPool.js";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] || ""]);
    return acc;
  }, []),
);

const DEST = args.dest || "庐山";
const REGION = args.region || "江西省九江市";
const RADIUS = Number(args.radius || 12000);
const COMPARE = args.compare || "";
// 只取"可游览"的分类：风景名胜 / 寺庙道观 / 文物古迹 / 公园广场 / 山峰
const TYPES = args.types || "风景名胜|寺庙道观|文物古迹|公园广场";

function loadKey() {
  if (process.env.GAODE_KEY) return process.env.GAODE_KEY;
  const env = readFileSync(join(root, ".env"), "utf8");
  const m = env.match(/^GAODE_KEY=(.+)$/m);
  return m ? m[1].trim() : "";
}
const KEY = loadKey();
if (!KEY) { console.error("缺少 GAODE_KEY"); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 高德 Web 服务有 CUQPS 限制，串行 + 节流 + 退避重试
let lastCallAt = 0;
async function get(url, attempt = 0) {
  const gap = 380 - (Date.now() - lastCallAt);
  if (gap > 0) await sleep(gap);
  lastCallAt = Date.now();
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (String(j.status) !== "1") {
    if (/CUQPS|QPS|LIMIT|EXCEED/.test(String(j.info || "")) && attempt < 5) {
      await sleep(1200 * (attempt + 1));
      return get(url, attempt + 1);
    }
    throw new Error(`${j.info} ${j.infocode}`);
  }
  return j;
}

async function geocode(name, region) {
  const j = await get(`https://restapi.amap.com/v3/geocode/geo?key=${KEY}&address=${encodeURIComponent(name)}&city=${encodeURIComponent(region || "")}`);
  const g = j.geocodes?.[0];
  if (!g) return null;
  const [lng, lat] = String(g.location).split(",").map(Number);
  return { lng, lat, formatted: g.formatted_address };
}

// 明显不是游览点：餐饮住宿、票务交通设施、纯商业
const JUNK = /餐|饮|饭|酒店|宾馆|民宿|客栈|超市|便利店|停车场|售票|游客中心|服务中心|管理处|观光车|索道站|公交|地铁|厕所|卫生间|充电站|加油站|快递|银行|医院|诊所|药店|学校|幼儿园|小区|广场舞/;

async function aroundPois(lng, lat, radius, types) {
  const out = [];
  // 坑：单次检索最多 25×3=75 条，按 weight 排序会把山里偏远的核心点挤掉。
  // 改成按距离排序 + 按半径分片（近→远各取一次），保证近处的点不被上限吃掉。
  const bands = [radius / 4, radius / 2, radius].map((r) => Math.max(500, Math.round(r)));
  for (const band of bands) {
  for (let page = 1; page <= 3; page++) {
    const j = await get(
      `https://restapi.amap.com/v3/place/around?key=${KEY}&location=${lng},${lat}&radius=${band}` +
      `&types=${encodeURIComponent(types)}&offset=25&page=${page}&extensions=all&sortrule=distance`,
    );
    const pois = j.pois || [];
    for (const p of pois) {
      if (!p.location) continue;
      const [plng, plat] = p.location.split(",").map(Number);
      out.push({
        name: p.name,
        type: p.type,
        typecode: p.typecode,
        rating: p.biz_ext?.rating ? Number(p.biz_ext.rating) : null,
        cost: p.biz_ext?.cost || null,
        address: p.address,
        pname: p.pname,
        cityname: p.cityname,
        adname: p.adname,
        lng: plng,
        lat: plat,
        dist: p.distance ? Number(p.distance) : null,
      });
    }
    if (pois.length < 25) break;
  }
  }
  return out;
}

function normName(s) {
  return String(s || "")
    .replace(/\(.*?\)|（.*?）/g, "")
    .replace(/风景名胜区|国家级旅游风景名胜区|国家森林公园|国家重点风景名胜区|景区|旅游区/g, "")
    .replace(/[\s·－-]/g, "");
}

// 锚点优先级：高德"风景名胜"分类检索（国家级/省级景点）> 地名地理编码
// 背景：geocode("庐山") 会解析到庐山市城区（山脚 12km），用它做圆心整座山都检索不到。
async function scenicAnchor(name, region) {
  const cityPart = String(region || "").replace(/[省市].*$/, "") || String(region || "");
  const j = await get(
    `https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent(name)}` +
    `&city=${encodeURIComponent(cityPart)}&types=110000&offset=25&extensions=base`,
  );
  const pois = (j.pois || []).filter((p) => p.location);
  const score = (p) => {
    let s = 0;
    if (/1102/.test(String(p.typecode))) s += 5; // 国家级/省级景点
    if (String(p.name).includes(name)) s += 3;
    if (/风景名胜区|旅游景区|国家森林公园/.test(p.name)) s += 2;
    return s;
  };
  const best = pois.slice().sort((a, b) => score(b) - score(a))[0];
  if (!best) return null;
  const [lng, lat] = String(best.location).split(",").map(Number);
  return { lng, lat, formatted: `${best.name}｜${best.pname}${best.cityname}${best.adname}`, name: best.name, via: "scenic-anchor" };
}

let dest = await scenicAnchor(DEST, REGION);
if (!dest) { dest = await geocode(DEST, REGION); if (dest) dest.via = "geocode-fallback"; }
if (!dest) { console.error(`查不到 ${DEST} 的坐标`); process.exit(1); }
console.log(`▶ ${DEST}（${REGION}） 锚点 ${dest.lng.toFixed(4)},${dest.lat.toFixed(4)} · ${dest.formatted}`);

const lookups = [
  { label: "目的地锚点", coords: [{ ...dest, name: DEST }] },
];
// 子景点常离锚点几公里（三叠泉距牯岭 6km），再补一轮以核心景点为圆心的扫描
const anchors = await aroundPois(dest.lng, dest.lat, RADIUS, TYPES);
anchors.sort((a, b) => (b.rating || 0) - (a.rating || 0));
const sub = anchors.filter((p) => p.dist != null && p.dist > 3000).slice(0, 2);
for (const s of sub) lookups.push({ label: `子圆心 ${s.name}`, coords: [{ lng: s.lng, lat: s.lat, name: s.name }] });

const seen = new Map();
for (const lu of lookups) {
  for (const c of lu.coords) {
    const pois = await aroundPois(c.lng, c.lat, lu.label === "目的地锚点" ? RADIUS : 8000, TYPES);
    for (const p of pois) {
      const key = normName(p.name);
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || (p.rating || 0) > (prev.rating || 0)) seen.set(key, { ...p, via: lu.label });
    }
  }
}

const all = [...seen.values()].sort((a, b) => (b.rating || 0) - (a.rating || 0) || (a.dist || 9e9) - (b.dist || 9e9));
const JUNKED = all.filter((p) => JUNK.test(p.name));
const { pool: KEEP_POOL, dropped } = buildPool(all, { destName: DEST, minRating: 3.5, limit: 40 });
const keep = KEEP_POOL;

// 区域校验：place 结果自带 pname/cityname/adname，不用逐个 regeo（省 QPS）
const outOfRegion = [];
for (const p of keep) {
  p.regeo = `${p.pname || ""}${p.cityname || ""}${p.adname || ""}`;
  if (REGION && !p.regeo.includes(REGION.replace(/[省市]/g, "").slice(0, 2))) outOfRegion.push(p);
}

console.log(`\n结构化检索到 ${all.length} 个候选 → 候选池 ${keep.length} 个（名称规则丢弃 ${dropped.nonSite}、低分丢弃 ${dropped.lowRating}、合并重复 ${dropped.dup}）`);
if (outOfRegion.length) console.log(`⚠️ 落在填写地区之外 ${outOfRegion.length} 个（需剔除）`);

console.log(`\n候选池（按可读性排序，前 40）:`);
for (const p of keep.filter((x) => !outOfRegion.includes(x))) {
  console.log(`  ${String(p.rating ?? "-").padStart(3)}★ ${(p.dist ?? 0).toString().padStart(6)}m  ${p.clean}  ← ${p.name}`);
}

if (JUNKED.length) {
  console.log(`\n名称规则额外拦下 ${JUNKED.length} 个（抽样 6）:`);
  for (const p of JUNKED.slice(0, 6)) console.log(`  ${p.name}`);
}

let coverage = null;
if (COMPARE) {
  const d = JSON.parse(readFileSync(COMPARE, "utf8"));
  const existing = Object.entries(d.locations || {}).map(([id, v]) => ({ id, name: v.name }));
  const structKeys = new Set(keep.map((p) => normName(p.name)));
  const structRaw = keep.map((p) => p.name);
  const covered = existing.filter((e) => {
    const k = normName(e.name);
    return structKeys.has(k) || structRaw.some((n) => normName(n).includes(k) || k.includes(normName(n)));
  });
  const missed = existing.filter((e) => !covered.includes(e));
  coverage = {
    existing: existing.length,
    covered: covered.length,
    missed: missed.map((m) => m.name),
    extra: keep.filter((p) => !existing.some((e) => {
      const k = normName(e.name);
      return normName(p.name) === k || normName(p.name).includes(k) || k.includes(normName(p.name));
    })).map((p) => p.name),
  };
  console.log(`\n与 ${COMPARE} 对比: 现有 ${coverage.existing} 个地点，结构化检索覆盖 ${coverage.covered} 个`);
  if (coverage.missed.length) console.log(`  结构性漏掉（需靠 AI/文章补）: ${coverage.missed.join("、")}`);
  if (coverage.extra.length) console.log(`  结构化多出: ${coverage.extra.join("、")}`);
}

const outDir = join(root, "scripts/out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `poi-${DEST}.json`);
writeFileSync(outFile, JSON.stringify({ dest: DEST, region: REGION, radius: RADIUS, anchor: dest, candidates: all, junkCount: JUNKED.length, coverage }, null, 2));
console.log(`\n明细已写入 ${outFile}`);
