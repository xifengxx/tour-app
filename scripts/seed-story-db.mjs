// 把 src/data/story/*.json 的案头/机位内容灌进 locations 表（timeline / figures / shot 三列）。
// 前置：先在 Supabase SQL Editor 执行 supabase/route-story.sql（建三列）。
// 用法：
//   node scripts/seed-story-db.mjs --dry     # 只列清单，不写库
//   node scripts/seed-story-db.mjs          # 写入（service_role，绕过 RLS）
// 幂等：可重复跑，只按 loc id 覆盖这三列，不动其它字段。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const STORY_DIR = fileURLToPath(new URL("../src/data/story", import.meta.url));
const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));

function env(name, fallbackRe) {
  if (process.env[name]) return process.env[name];
  if (!existsSync(ENV_PATH)) return "";
  const text = readFileSync(ENV_PATH, "utf8");
  const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
  if (m) return m[1].trim();
  if (fallbackRe) {
    const alt = text.match(fallbackRe);
    if (alt) return alt[1].trim();
  }
  return "";
}

const URL_BASE = env("VITE_SUPABASE_URL");
const KEY = env("SERVICE_ROLE_KEY");
const DRY = process.argv.includes("--dry");

if (!URL_BASE || !KEY) {
  console.error("✗ 缺 VITE_SUPABASE_URL 或 SERVICE_ROLE_KEY（.env）");
  process.exit(1);
}

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text;
}

async function main() {
  // 0) 先确认列存在——没有就明确提示去跑 SQL，而不是写一半
  try {
    await rest("locations?select=timeline&limit=1");
  } catch (e) {
    if (String(e.message).includes("42703") || String(e.message).includes("does not exist")) {
      console.error("✗ locations 表还没有 timeline/figures/shot 列。");
      console.error("  请先在 Supabase SQL Editor 执行 supabase/route-story.sql，再重跑本脚本。");
      process.exit(2);
    }
    throw e;
  }

  const files = readdirSync(STORY_DIR).filter((f) => f.endsWith(".json"));
  let locTotal = 0;
  let wrote = 0;
  const problems = [];

  for (const file of files) {
    const seed = JSON.parse(readFileSync(join(STORY_DIR, file), "utf8"));
    for (const [locId, entry] of Object.entries(seed.locations || {})) {
      locTotal += 1;
      const patch = {};
      if (Array.isArray(entry.timeline) && entry.timeline.length) patch.timeline = entry.timeline;
      if (Array.isArray(entry.figures) && entry.figures.length) patch.figures = entry.figures;
      if (Array.isArray(entry.shot) && entry.shot.length) patch.shot = entry.shot;
      if (!Object.keys(patch).length) {
        problems.push(`${file} · ${locId}：三件套全空，跳过`);
        continue;
      }

      // 先核对这个 loc 存在且归属正确，避免把内容写错导览
      const probe = await rest(`locations?select=id,tour_id,name&id=eq.${encodeURIComponent(locId)}`);
      const rows = JSON.parse(probe || "[]");
      if (!rows.length) {
        problems.push(`${file} · ${locId}：库里没有这个地点`);
        continue;
      }
      if (rows[0].tour_id !== seed.tourId) {
        problems.push(`${file} · ${locId}：tour_id 不符（库=${rows[0].tour_id} JSON=${seed.tourId}）`);
        continue;
      }

      if (DRY) {
        console.log(`· ${seed.tourName || file} / ${rows[0].name}  轴${patch.timeline?.length || 0} 人${patch.figures?.length || 0} 机位${patch.shot?.length || 0}`);
        continue;
      }
      await rest(`locations?id=eq.${encodeURIComponent(locId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      wrote += 1;
    }
  }

  console.log(`\n${DRY ? "[dry] " : ""}文件 ${files.length} 个 · 地点 ${locTotal} 条 · ${DRY ? "待写" : "已写"} ${DRY ? locTotal - problems.length : wrote} 条`);
  if (problems.length) {
    console.log(`\n有 ${problems.length} 条没处理：`);
    problems.forEach((p) => console.log("  ! " + p));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
