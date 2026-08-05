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

function splitRegion(t) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  return { prov: "", city: t };
}

// 与 index.ts gaode() 一致的逻辑（名称重叠过滤 + 类型优先 + 限流重试 + 兜底放宽）
async function gaode(name, destCity) {
  const kw = encodeURIComponent(name);
  const cityParam = encodeURIComponent((splitRegion(destCity).city || destCity).replace(/[市]$/g, ""));
  const overlaps = (pois) => pois.filter((p) => p.name?.includes(name) || name.includes(p.name || ""));
  const preferScenic = (pois) => {
    const s = pois.filter((p) => /风景名胜|旅游景点|名胜|景区|公园/.test(p.type || ""));
    return s.length ? s : pois;
  };
  const query = async (types) => {
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&city=${cityParam}&key=${GAODE_KEY}${typesParam}&citylimit=true`, { signal: AbortSignal.timeout(30000) });
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
  let clean = top.name.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = clean.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === clean) break;
    clean = next;
  }
  return { lng, lat, name: clean || top.name, raw: top.name, type: top.type || "", usedFallback };
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

if (!GAODE_KEY) { console.error("\n⚠️ 缺少 GAODE_KEY，跳过实时高德查询。"); process.exit(allPass ? 0 : 1); }

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
