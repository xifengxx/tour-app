// 给知识草案里的 stops 补高德坐标（process-tour 的 injectTrailSeeds 只吃带坐标的 stop）
// 用法：node scripts/fill-knowledge-coords.mjs --file docs/knowledge-drafts/sanqingshan.json --city 上饶
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] || ""]);
    return acc;
  }, []),
);
const FILE = args.file;
const CITY = args.city || "";
if (!FILE) { console.error("缺少 --file"); process.exit(1); }

const KEY = (() => {
  if (process.env.GAODE_KEY) return process.env.GAODE_KEY;
  const env = readFileSync(join(root, ".env"), "utf8");
  const m = env.match(/^GAODE_KEY=(.+)$/m);
  return m ? m[1].trim() : "";
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url) {
  const gap = 380 - (Date.now() - last);
  if (gap > 0) await sleep(gap);
  last = Date.now();
  const res = await fetch(url);
  const j = await res.json().catch(() => ({}));
  if (String(j.status) !== "1") return { pois: [] };
  return j;
}

// 名称相似度：去掉"三清山/景区/风景区"后比对，避免把"三清山索道站"当成"三清宫"
function core(s) {
  return String(s || "").replace(/三清山|景区|风景区|国家级|旅游/g, "").replace(/[\s·－()-]/g, "");
}

async function lookup(name, destName) {
  const tries = [name, `${destName}${name}`];
  for (const kw of tries) {
    const j = await get(
      `https://restapi.amap.com/v3/place/text?key=${KEY}&keywords=${encodeURIComponent(kw)}` +
      `&city=${encodeURIComponent(CITY)}&offset=10&extensions=base`,
    );
    const pois = (j.pois || []).filter((p) => p.location);
    const hit = pois.find((p) => {
      const a = core(p.name);
      const b = core(name);
      return a === b || a.includes(b) || b.includes(a);
    });
    if (hit) {
      const [lng, lat] = String(hit.location).split(",").map(Number);
      return { name: hit.name, lat, lng, via: kw };
    }
  }
  return null;
}

const draft = JSON.parse(readFileSync(FILE, "utf8"));
const destName = draft.destination_name || "";
const report = [];
for (const trail of draft.model.trails || []) {
  for (const stop of trail.stops || []) {
    if (Number.isFinite(stop.lat) && Number.isFinite(stop.lng)) {
      stop.required = stop.required ?? true;
      report.push(`已有  ${stop.name}`);
      continue;
    }
    const hit = await lookup(stop.name, destName);
    if (hit) {
      stop.lat = hit.lat;
      stop.lng = hit.lng;
      stop.amapName = hit.name;
      stop.required = true;
      report.push(`✅ ${stop.name} → ${hit.name} @${hit.lat},${hit.lng}`);
    } else {
      // 找不到坐标的站点不标 required，避免注入不可信点位
      stop.required = false;
      report.push(`❌ ${stop.name} 未解析到坐标（不注入）`);
    }
  }
}
writeFileSync(FILE, JSON.stringify(draft, null, 2) + "\n");
console.log(report.join("\n"));
const ok = report.filter((r) => r.startsWith("✅") || r.startsWith("已有")).length;
console.log(`\n解析成功 ${ok} / ${report.length}`);
