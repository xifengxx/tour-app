// 本地生成目的地路线知识（v90，只读验证工具）
//
// 用途有两个：
//   1. 在把知识写进 destination_route_knowledge 之前，先离线看清 auto-research
//      到底抽出了什么（几条步道、有没有 edges、置信度多少），决定要不要人工修正；
//   2. 给 audit-routes.ts --knowledge 提供输入，从而复现"线上有真实知识"那条路径。
//      没有它，体检只能跑 L1 无知识路径，读数是有偏的下限。
//
// 这个脚本**不写 Supabase**：只抓 Wikipedia / OSM / 高德 + 调 DeepSeek，
// 结果写本地 JSON。落库仍走 route-research Edge Function（需 ROUTE_RESEARCH_SECRET）。
//
// 用法：
//   set -a && . ./.env && set +a
//   export GAODE_KEY=<高德 Web 服务 Key>
//   deno run --allow-net --allow-env --allow-read --allow-write \
//     scripts/research-knowledge.ts 玉龙雪山 云南 --out scripts/out/knowledge/玉龙雪山.json

import { researchRouteKnowledge } from "../supabase/functions/route-research/research.ts";
import { scoreKnowledge } from "../supabase/functions/process-tour/knowledge-quality.ts";
import { capabilitiesFor, TIER_LABEL } from "../supabase/functions/process-tour/knowledge-tier.ts";
import { qualityGaps } from "../supabase/functions/process-tour/knowledge-quality.ts";
import type { DestinationRouteKnowledge } from "../supabase/functions/process-tour/route-knowledge-types.ts";

const [dest, region = "", ...rest] = Deno.args;
if (!dest) {
  console.error("用法: deno run ... scripts/research-knowledge.ts <目的地> [地区] [--out <文件>]");
  Deno.exit(1);
}
if (!Deno.env.get("DEEPSEEK_API_KEY")) {
  console.error("缺少 DEEPSEEK_API_KEY");
  Deno.exit(1);
}
if (!Deno.env.get("GAODE_KEY")) {
  console.error("缺少 GAODE_KEY（高德 Web 服务 Key，不是 JS API Key）");
  Deno.exit(1);
}
const outIdx = rest.indexOf("--out");
const outFile = outIdx >= 0 ? rest[outIdx + 1] : "";
const typeIdx = rest.indexOf("--type");
const destType = typeIdx >= 0 ? String(rest[typeIdx + 1] || "") : "";

const started = Date.now();
console.log(`研究 ${dest}（${region || "未填地区"}）${destType ? " type=" + destType : ""}...`);
const result = await researchRouteKnowledge(dest, region, destType || undefined);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n耗时 ${seconds}s，外部证据 ${result.evidence.length} 组来源：`);
for (const e of result.evidence) {
  console.log(`  · ${e.provider.padEnd(13)} ${(e.title || "").slice(0, 40).padEnd(42)} ${e.text.length} 字`);
}

const knowledge: DestinationRouteKnowledge = {
  destinationName: result.destination_name,
  aliases: result.aliases,
  zones: result.zones,
  trails: result.trails,
  edges: result.edges,
  source: "auto-research",
  // result.confidence 已由 normalizeResearchResult 按证据事实算出（v91），
  // 模型自评级在归一化阶段就被丢弃。
  confidence: result.confidence,
};
const { tier, capabilities } = capabilitiesFor(knowledge);

console.log(`\n抽取结果：zones ${result.zones.length} / trails ${result.trails.length} / edges ${result.edges.length}`);
const quality = (knowledge.quality ??= scoreKnowledge(knowledge));
console.log(`完整度 ${quality.score}（${quality.grade}）　分项：来源 ${quality.parts.sourceTrust} ｜ 坐标覆盖 ${quality.parts.coordCoverage} ｜ 证据可追溯 ${quality.parts.evidenceCoverage} ｜ 无设施噪声 ${quality.parts.sitePurity} ｜ 结构 ${quality.parts.structureCompleteness} ｜ 交通边覆盖 ${quality.transportCoverage}`);
const gaps = qualityGaps(quality);
if (gaps.length) {
  console.log("待补齐：");
  for (const g of gaps) console.log(`  · ${g}`);
}
console.log(`落库时 confidence 使用 ${quality.score}（自动研究上限 0.8，不会盖过人工策展）`);
console.log(`能力分层：${tier} ${TIER_LABEL[tier]} → 多日线 ${capabilities.multiDay ? "允许" : "不允许"}、主题游 ${capabilities.themeTour ? "允许" : "不允许"}、分区选点 ${capabilities.zoneDriven ? "允许" : "不允许"}、交通断言 ${capabilities.assertTransport ? "允许" : "不允许"}`);

const modes: Record<string, number> = {};
for (const edge of result.edges) modes[edge.mode] = (modes[edge.mode] || 0) + 1;
if (Object.keys(modes).length) console.log(`\nedges 交通方式分布：${JSON.stringify(modes)}`);

console.log("\nzones:");
for (const z of result.zones) console.log(`  ${z.id.padEnd(20)} ${z.name}  aliases=${(z.aliases || []).join("/")}`);

console.log("\ntrails:");
for (const t of result.trails) {
  const withCoord = t.stops.filter(s => s.lat && s.lng).length;
  const required = t.stops.filter(s => s.required).length;
  const evidenced = (t.evidence || []).length;
  console.log(`  ${(t.id || "-").padEnd(26)} zone=${String(t.zoneId || "-").padEnd(18)} 站点 ${String(t.stops.length).padStart(2)}（坐标 ${withCoord}、必选 ${required}、有证据句 ${evidenced}）`);
  console.log(`      ${t.stops.map(s => s.name).join(" → ").slice(0, 200)}`);
  if (t.notes) console.log(`      备注：${t.notes.slice(0, 160)}`);
  for (const ev of (t.evidence || []).slice(0, 2)) console.log(`      证据：${String(ev).slice(0, 140)}`);
}

if (outFile) {
  await Deno.mkdir(outFile.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await Deno.writeTextFile(outFile, JSON.stringify({ ...knowledge, generatedAt: new Date().toISOString(), evidence: result.evidence.map(e => ({ provider: e.provider, title: e.title, url: e.url })) }, null, 2));
  console.log(`\n已写出 ${outFile}（未写 Supabase）`);
}
