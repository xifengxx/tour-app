// 嵩山导览失败复现：高德侧管线诊断（不调 DeepSeek、不写库）
// 验证假设：regionMatch 不查 district → 用户地区填"河南登封/河南省登封市"时全部地点被拒 → locs=0 → status=error
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function loadKey() {
  if (process.env.GAODE_KEY) return process.env.GAODE_KEY;
  const envPath = new URL("../.env", import.meta.url).pathname;
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(/^GAODE_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  const backup = join(homedir(), "session-backup-9d6c4422.jsonl");
  if (existsSync(backup)) {
    const m = readFileSync(backup, "utf8").match(/2ff1[a-f0-9]{28}/);
    if (m) return m[0];
  }
  return "";
}
const GAODE_KEY = loadKey();
if (!GAODE_KEY) { console.error("无 GAODE_KEY"); process.exit(1); }

// ── 镜像 index.ts 的 splitRegion / regionMatch（逐字复制） ──
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
function regionMatch(geo, targetRegion) {
  if (!geo) return false;
  const norm = String(targetRegion).trim();
  if (!norm) return false;
  const gProv = String(geo.province || "");
  const gCity = Array.isArray(geo.city) ? (geo.city[0] || "") : String(geo.city || "");
  const gCityCand = gCity || gProv;
  const stripSuffix = (s) => String(s).replace(/[市]$/g, "");
  const sheng = norm.indexOf("省");
  const zzq = norm.indexOf("自治区");
  let provPart = "", cityPart = "";
  if (sheng > -1) { provPart = norm.slice(0, sheng); cityPart = norm.slice(sheng + 1); }
  else if (zzq > -1) { provPart = norm.slice(0, zzq); cityPart = norm.slice(zzq + 3); }
  if (cityPart) {
    const tCityCands = [cityPart, stripSuffix(cityPart)];
    return tCityCands.some(tc => tc && (gCityCand.includes(tc) || tc.includes(stripSuffix(gCityCand))));
  }
  if (provPart) {
    const tProvCands = [provPart, stripSuffix(provPart)];
    return tProvCands.some(tp => tp && gProv.includes(tp));
  }
  const gCityN = gCityCand.replace(/[市]$/g, "");
  if (gCityN && norm.includes(gCityN)) return true;
  if (norm.length <= 3) {
    const gProvN = gProv.replace(/省$/, "");
    return gProv.includes(norm) || (gProvN && norm.includes(gProvN));
  }
  return false;
}
// 镜像 gaode() 名称解析
async function gaode(name, destCity, bias) {
  const kw = encodeURIComponent(name);
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const rawCity = (splitRegion(destCity).city || destCity).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `&city=${encodeURIComponent(rawCity)}&citylimit=true`;
  const overlaps = (pois) => pois.filter((p) => p.name?.includes(name) || name.includes(p.name || ""));
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
  if (!matched.length) matched = overlaps(await query(null));
  if (!matched.length) return null;
  const top = matched[0];
  const [lng, lat] = top.location.split(",").map(Number);
  return { lng, lat, name: top.name };
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

// ── 1. 模拟用户创建嵩山导览时可能填的几种"地区"写法 ──
const REGION_INPUTS = ["河南省郑州市", "河南登封", "河南省登封市", "郑州市", "河南", "登封市"];

// AI 提取嵩山景区典型名单（模拟 DeepSeek 提取结果）
const SONGSHAN_SPOTS = ["少林寺", "塔林", "三皇寨", "中岳庙", "嵩阳书院", "峻极峰", "卢崖瀑布", "观星台", "会善寺", "永泰寺", "太室山", "少室山"];

console.log("=== 1. 目的地偏置：gaode(\"嵩山\", 各地区写法) ===");
const destLocs = {};
for (const region of REGION_INPUTS) {
  const c = await gaode("嵩山", region).catch(() => null);
  destLocs[region] = c;
  console.log(`  region="${region}" → ${c ? `"${c.name}" @ (${c.lng},${c.lat})` : "null"}`);
}

console.log("\n=== 2. 逐景点解析 + 地区校验（region 对 regionMatch 的影响矩阵） ===");
for (const region of REGION_INPUTS) {
  const bias = destLocs[region] || destLocs["河南省郑州市"] || undefined;
  let ok = 0, rejected = 0, notFound = 0;
  const detail = [];
  for (const spot of SONGSHAN_SPOTS) {
    const c = await gaode(spot, region, bias).catch(() => null);
    if (!c) { notFound++; detail.push(`✗${spot}(未找到)`); continue; }
    const geo = await regeo(c.lng, c.lat);
    if (!geo) { notFound++; detail.push(`✗${spot}(regeo失败)`); continue; }
    const pass = regionMatch(geo, region);
    if (pass) { ok++; }
    else { rejected++; detail.push(`✗${spot}→${geo.province}${Array.isArray(geo.city) ? geo.city[0] || "" : geo.city}${geo.district}`); }
  }
  console.log(`  region="${region}": 通过 ${ok} / 被拒 ${rejected} / 未找到 ${notFound}${locsZeroWarn(ok)}`);
  if (detail.length) console.log(`    ${detail.join(" ")}`);
}
function locsZeroWarn(ok) { return ok === 0 ? "  ⚠️⚠️ locs=0 → 主流程 throw → status=error（嵩山失败界面）" : ""; }

console.log("\n=== 3. regeo 原始返回：少林寺/中岳庙 的 province/city/district ===");
for (const spot of ["少林寺", "中岳庙", "嵩阳书院"]) {
  const c = await gaode(spot, "河南省郑州市", destLocs["河南省郑州市"] || undefined).catch(() => null);
  if (!c) { console.log(`  ${spot}: gaode 未找到`); continue; }
  const geo = await regeo(c.lng, c.lat);
  console.log(`  ${spot} @ (${c.lng},${c.lat}) → province=${geo?.province} city=${JSON.stringify(geo?.city)} district=${geo?.district}`);
}

console.log("\n=== 4. regionScenics 对郑州的召回（判断地区合并规模 → 内容 chunk 数量 → 截断风险） ===");
{
  const r = await fetch(`https://restapi.amap.com/v3/place/text?city=${encodeURIComponent("郑州")}&key=${GAODE_KEY}&types=${encodeURIComponent("风景名胜|旅游景点")}&citylimit=true&offset=30`, { signal: AbortSignal.timeout(30000) });
  const d = await r.json();
  const names = (d.pois || []).filter(p => p.location && !/省.*市/.test(p.name || "")).map(p => p.name);
  console.log(`  郑州风景名胜 ${names.length} 个: ${names.slice(0, 30).join("、")}`);
}
