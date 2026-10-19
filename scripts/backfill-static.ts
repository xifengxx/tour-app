// v99.7：给两条内置静态演示导览（剑出衡山/笑傲华山）回填真实路径与海拔剖面。
// 它们早于管线存在，只有 stops+narrative；现在用与 process-tour 完全相同的
// route-paths/elevation/route-legs 模块离线生成 path+prof+legs 写回 JSON。
// 用法：GAODE_KEY=xxx deno run --allow-net --allow-read --allow-write scripts/backfill-static.ts [--dry]
import { buildRoutePath } from "../supabase/functions/process-tour/route-paths.ts";
import { elevationProfile } from "../supabase/functions/process-tour/elevation.ts";
import { buildRouteLegs } from "../supabase/functions/process-tour/route-graph.ts";

const KEY = Deno.env.get("GAODE_KEY") || "";
if (!KEY) { console.error("需要 GAODE_KEY"); Deno.exit(1); }
const dry = Deno.args.includes("--dry");
const EMPTY_KNOWLEDGE = { destinationName: "", aliases: [], zones: [], trails: [], edges: [], source: "none", confidence: 0 } as never;

for (const file of ["public/data/henshan.json", "public/data/huashan.json"]) {
  const d = JSON.parse(Deno.readTextFileSync(file));
  const byId = Object.fromEntries((d.locations || []).map((l: any) => [l.id, l]));
  console.log(`\n### ${d.meta?.title || file}`);
  for (const r of d.routes || []) {
    const coords = (r.stops || []).map((id: string) => byId[id]).filter((l: any) => l && Number.isFinite(l.lng) && Number.isFinite(l.lat));
    if (coords.length < 2) { console.log(`  [${r.day}] ${r.title}: 站点不足，跳过`); continue; }
    const legs = buildRouteLegs(r.stops, d.locations, EMPTY_KNOWLEDGE);
    r.legs = legs;
    const path = await buildRoutePath(coords.map((l: any) => [l.lng, l.lat] as [number, number]), legs.map((l: any) => l.mode), fetch, KEY);
    if (path && path.planned > 0) r.path = path;
    const sample = path && path.geom.length > 1 ? path.geom.map(([lng, lat]) => ({ lng, lat })) : coords.map((l: any) => ({ lng: l.lng, lat: l.lat }));
    const prof = await elevationProfile(sample as any, 100);
    if (prof) r.prof = prof.map((p: any) => [p.km, p.m]); // 静态 JSON 用 [km,m] 数组（前端直接消费）
    console.log(`  [${r.day}] ${r.title}: ${coords.length}站 path=${r.path ? `${r.path.planned}真实/${r.path.fellBack}直线 ${r.path.totalKm}km` : "无"} prof=${r.prof ? `${r.prof.length}点` : "无"}`);
  }
  if (!dry) Deno.writeTextFileSync(file, JSON.stringify(d, null, 2) + "\n");
}
console.log(dry ? "\n（dry-run，未写文件）" : "\n已写回 JSON。");
