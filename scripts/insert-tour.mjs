#!/usr/bin/env node
/**
 * 标准化导览数据插入脚本
 *
 * 用法:
 *   1. 先创建 JSON 数据文件（如 scripts/taishan-data.json）
 *      - 格式: { TOUR: "uuid", locs: [...], routes: [...] }
 *   2. 运行: node scripts/insert-tour.mjs scripts/taishan-data.json
 *
 * 此脚本避免中文引号在 JS/SQL 中的转义问题：
 *   - 数据存在 JSON 文件中（中文天然安全）
 *   - 脚本读取 JSON → 转义单引号 → Management API 写入 Supabase
 */

import { readFileSync } from "fs";

const TOKEN = process.env.SUPABASE_PAT;
const REF = "qxunedraoviaonjdanag";
const API = `https://api.supabase.com/v1/projects/${REF}/database/query`;

async function query(sql) {
  const r = await fetch(API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) {
    const text = await r.text();
    console.error(`  ❌ SQL [${r.status}]:`, text.substring(0, 200));
    return null;
  }
  return r.json();
}

/** Escape single quotes for PostgreSQL string literal */
function esc(s) {
  if (typeof s !== "string") return String(s);
  return s.replace(/'/g, "''");
}

async function main() {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error("用法: node scripts/insert-tour.mjs <data.json>");
    console.error("JSON 格式: { TOUR: 'uuid', locs: [...], routes: [...] }");
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(jsonPath, "utf8"));
  const T = data.TOUR;

  if (!T || !data.locs || !data.routes) {
    console.error("JSON 缺少 TOUR / locs / routes 字段");
    process.exit(1);
  }

  // ── Clear old data ──
  console.log("🗑  清除旧数据...");
  await query(`DELETE FROM locations WHERE tour_id='${T}'`);
  await query(`DELETE FROM routes WHERE tour_id='${T}'`);

  // ── Insert locations ──
  console.log(`📍 写入 ${data.locs.length} 个地点...`);
  for (const loc of data.locs) {
    const layers = JSON.stringify(loc.layers);
    const practical = JSON.stringify(loc.practical || {});
    const tags = "{" + (loc.tags || []).map(t => `"${t}"`).join(",") + "}";
    const reflection = loc.reflection || "";

    const sql =
      `INSERT INTO locations(id,tour_id,name,lat,lng,elevation,importance,tags,layers,reflection,practical,sort_order) ` +
      `VALUES(` +
      `'${loc.id}','${T}','${esc(loc.name)}',${loc.lat},${loc.lng},'${esc(loc.elevation || "")}',` +
      `${loc.importance || 3},'${tags}','${esc(layers)}','${esc(reflection)}','${esc(practical)}',` +
      `${data.locs.indexOf(loc)}` +
      `)`;

    const res = await query(sql);
    if (res !== null) console.log(`  ✅ ${loc.name}`);
  }

  // ── Insert routes ──
  console.log(`\n🗺  写入 ${data.routes.length} 条路线...`);
  for (const r of data.routes) {
    const stops = "{" + (r.stops || []).map(s => `"${s}"`).join(",") + "}";
    const sql =
      `INSERT INTO routes(id,tour_id,day_label,title,stops,narrative,sort_order) ` +
      `VALUES(` +
      `'${r.id}','${T}','${esc(r.day_label || "")}','${esc(r.title)}',` +
      `'${stops}','${esc(r.narrative || "")}',${r.sort_order || 0}` +
      `)`;

    const res = await query(sql);
    if (res !== null) console.log(`  ✅ ${r.title}`);
  }

  // ── Verify ──
  const locCount = await query(
    `SELECT count(*) as c FROM locations WHERE tour_id='${T}'`
  );
  const routeCount = await query(
    `SELECT count(*) as c FROM routes WHERE tour_id='${T}'`
  );

  console.log(
    `\n🎉 完成！地点: ${locCount?.[0]?.c ?? "?"}, 路线: ${routeCount?.[0]?.c ?? "?"}`
  );
  console.log(`🔗 http://localhost:5173/tour/${T}`);
}

main().catch((e) => {
  console.error("💥", e.message);
  process.exit(1);
});
