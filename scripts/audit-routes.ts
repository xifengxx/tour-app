// 路线质量体检（P1-5）
//
// 用真实的 Edge Function 模块（route-graph.ts）重算线上每条路线的交通分段与结构问题，
// 与数据库中已落库的 legs 对比，输出可核查的质量报告。
//
// 为什么需要它：现网 12+ 条导览里只有 1 条带 prof、2 条带 legs，
// 而规划逻辑改一次就可能同时影响所有目的地。没有基线就只能"修一个案例、盲改全局"。
//
// 用法：
//   set -a && . ./.env && set +a
//   deno run --allow-net --allow-read --allow-env scripts/audit-routes.ts
//   deno run --allow-net --allow-read --allow-env --allow-write scripts/audit-routes.ts \
//     --json scripts/out/route-audit-baseline.json   # 生成回归基线（需要 --allow-write）
//
// 只读：全程仅 SELECT，不写库、不改文件（除 --json 显式指定的输出）。

import { buildRouteLegs, estimateRouteDuration, routeGraphIssues, routeLegsText } from "../supabase/functions/process-tour/route-graph.ts";
import { CURATED_TRAILS } from "../supabase/functions/process-tour/trail-routes.ts";
import type { DestinationRouteKnowledge } from "../supabase/functions/process-tour/route-knowledge-types.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
const ANON_KEY = Deno.env.get("VITE_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
if (!SUPABASE_URL || !ANON_KEY) {
  console.error("缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY（先 `set -a && . ./.env && set +a`）");
  Deno.exit(1);
}
const jsonOut = (() => {
  const i = Deno.args.indexOf("--json");
  return i >= 0 ? Deno.args[i + 1] : null;
})();

const hdr = { apikey: ANON_KEY!, Authorization: `Bearer ${ANON_KEY!}` };

async function select<T>(path: string): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL!}/rest/v1/${path}`, { headers: hdr });
  if (!res.ok) throw new Error(`SELECT ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T[]>;
}

type Tour = { id: string; title: string; created_at: string; status: string; destination: any };
type Loc = { id: string; name: string; lat: number; lng: number; elevation: string; tags: string[]; importance: number };
type RouteRow = { id: string; tour_id: string; day_label: string; title: string; stops: string[]; legs: any[]; narrative: string };

// 目的地知识：命中内置策展步道时用 CURATED_TRAILS，否则空知识（等价于线上 L1 无知识场景）。
// destination_route_knowledge 表受 RLS 保护（仅 service_role），anon 无法读取，
// 需要精确复现时把该目的地知识导出为 JSON 后用 --knowledge 传入。
const knowledgeIdx = Deno.args.indexOf("--knowledge");
const knowledgeBundle: Record<string, any> = knowledgeIdx >= 0
  ? JSON.parse(Deno.readTextFileSync(Deno.args[knowledgeIdx + 1]))
  : {};

function knowledgeFor(destName: string): DestinationRouteKnowledge {
  const hit = Object.entries(knowledgeBundle).find(([name]) => destName.includes(name) || name.includes(destName));
  if (hit) {
    const m = hit[1]?.model || hit[1];
    return {
      destinationName: destName,
      aliases: [destName],
      zones: m.zones || [],
      trails: m.trails || [],
      edges: m.edges || [],
      source: hit[1]?.source || "imported",
      confidence: Number(hit[1]?.confidence ?? 0.9),
    };
  }
  const trails = CURATED_TRAILS.filter(t => (t.aliases || []).some(a => destName.includes(a) || a.includes(destName)));
  return {
    destinationName: destName,
    aliases: [destName],
    zones: [],
    trails,
    edges: [],
    source: trails.length ? "builtin" : "none",
    confidence: trails.length ? 0.5 : 0,
  };
}

const MODE_RANK: Record<string, number> = { walk: 0, cableway: 1, shuttle: 1, other: 1, car: 2 };

const tours = await select<Tour>("tours?select=id,title,created_at,status,destination&order=created_at.desc" + (Deno.args.includes("--all") ? "" : "&is_public=eq.true"));
const rows: any[] = [];
const summary = { tours: 0, routes: 0, storedLegs: 0, missingLegs: 0, modeChanged: 0, upgraded: 0, downgraded: 0, issues: 0, longDay: 0 };
// 无知识路径下的"改判"不代表线上会变好：那些目的地在生产上有 auto-research/策展边，
// 只是 destination_route_knowledge 受 RLS 保护、本脚本用 anon key 读不到。
// 混进主计数会把工具读数误导成"降级了 N 条路线"，所以单独统计。
const noKnowledge = { tours: 0, routes: 0, modeChanged: 0 };

for (const tour of tours) {
  const [locs, routes] = await Promise.all([
    select<Loc>(`locations?select=id,name,lat,lng,elevation,tags,importance&tour_id=eq.${tour.id}&order=sort_order`),
    select<RouteRow>(`routes?select=id,tour_id,day_label,title,stops,legs,narrative&tour_id=eq.${tour.id}&order=sort_order`),
  ]);
  const knowledge = knowledgeFor(String(tour.destination?.name || ""));
  const hasKnowledge = knowledge.source !== "none";
  summary.tours++;
  if (!hasKnowledge) noKnowledge.tours++;
  console.log(`\n── ${tour.title}  (${tour.created_at.slice(0, 10)} / 知识=${knowledge.source}${hasKnowledge ? "" : "（本脚本用 anon key 读不到知识表，下述改判不代表线上结果）"}, ${locs.length} 地点)`);

  for (const route of routes) {
    summary.routes++;
    const stopIds = route.stops || [];
    const next = buildRouteLegs(stopIds, locs, knowledge);
    const issues = routeGraphIssues(stopIds, locs, knowledge, {
      allowLongTransfers: route.day_label === "主题游",
      dayLabel: route.day_label,
    });
    const duration = estimateRouteDuration(next, stopIds.length);
    const stored = route.legs || [];
    if (!stored.length) summary.missingLegs++;
    summary.storedLegs += stored.length ? 1 : 0;

    const changed = next.filter((leg, i) => stored[i] && stored[i].mode && stored[i].mode !== leg.mode);
    if (!hasKnowledge) noKnowledge.routes++;
    summary.modeChanged += changed.length;
    if (!hasKnowledge) noKnowledge.modeChanged += changed.length;
    const up = changed.filter(l => MODE_RANK[l.mode] > MODE_RANK[String(stored.find(s => s.fromId === l.fromId && s.toId === l.toId)?.mode)]).length;
    summary.upgraded += up;
    summary.downgraded += changed.length - up;
    summary.issues += issues.length;
    if (issues.some(i => i.type === "long-day")) summary.longDay++;

    const flag = issues.length || changed.length ? "⚠" : " ";
    console.log(`   ${flag} [${route.day_label}] ${stopIds.length}站  落库legs=${stored.length} 重算legs=${next.length} 变化=${changed.length} 问题=${issues.length} 预计${(duration.totalMinutes / 60).toFixed(1)}h`);
    for (const leg of changed) {
      const before = stored.find(s => s.fromId === leg.fromId && s.toId === leg.toId)?.mode;
      const tag = hasKnowledge ? "改判" : "改判(无知识对照)";
      console.log(`       交通方式${tag} ${leg.fromName}→${leg.toName}: ${before} ⇒ ${leg.mode}（直线 ${Math.round((leg.distanceM || 0) / 100) / 10}km${leg.elevationDeltaM != null ? ` / 高差 ${Math.abs(leg.elevationDeltaM)}m` : ""}${leg.inferred ? "，资料无交通边、按物理量推断" : ""}）`);
    }
    for (const issue of issues) console.log(`       · ${issue.type}: ${issue.message}`);

    rows.push({
      tourId: tour.id, tourTitle: tour.title, routeId: route.id, dayLabel: route.day_label,
      stops: stopIds.length, storedLegs: stored.length, nextLegs: next.map(l => ({ from: l.fromName, to: l.toName, mode: l.mode, distanceM: l.distanceM, elevationDeltaM: l.elevationDeltaM, roadMinutes: l.roadMinutes, inferred: l.inferred, edgeMode: l.edgeMode })),
      changedModes: changed.map(l => `${l.fromId}>${l.toId}:${stored.find(s => s.fromId === l.fromId)?.mode}=>${l.mode}`),
      issues, durationMinutes: duration.totalMinutes, knowledgeSource: knowledge.source,
      narrativeInstruction: routeLegsText(next),
    });
  }
}

console.log("\n===== 汇总 =====");
console.log(JSON.stringify(summary, null, 2));
console.log(`其中 ${noKnowledge.tours} 个目的地（${noKnowledge.routes} 条路线）本次无路线知识可用，` +
  `其 ${noKnowledge.modeChanged} 处改判只是"L1 无知识路径"的对照，不计入有效改动；` +
  `有效改判 ${summary.modeChanged - noKnowledge.modeChanged} 处。`);
console.log("提示：要复现线上结果，请用 service_role 导出 destination_route_knowledge 后加 --knowledge <json>。");
if (jsonOut) {
  try {
    await Deno.writeTextFile(jsonOut, JSON.stringify({ auditedAt: new Date().toISOString(), summary, routes: rows }, null, 2));
    console.log(`快照已写入 ${jsonOut}`);
  } catch (e) {
    console.error(`写入快照失败：${e?.message || e}（写文件需要 --allow-write）`);
    Deno.exit(1);
  }
}
