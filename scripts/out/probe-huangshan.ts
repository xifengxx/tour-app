import { buildRouteGraph, matchLocsToGraph, planGraphStops, routeGraphIssues } from "../../supabase/functions/process-tour/route-graph.ts";
const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const rows = await (await fetch(`${url}/rest/v1/destination_route_knowledge?select=*&destination_name=like.%E9%BB%84%E5%B1%B1*`, { headers: H })).json();
if (!rows.length) { console.log("黄山无知识行"); }
const row = rows[0];
console.log("knowledge:", row?.source, "| trails:", (row?.model?.trails||[]).length, "| zones:", (row?.model?.zones||[]).length);
const knowledge = {
  destinationName: "黄山", aliases: row?.aliases || [], zones: row?.model?.zones || [],
  trails: row?.model?.trails || [], edges: row?.model?.edges || [], source: row?.source || "database",
  confidence: Number(row?.confidence || 0),
};
const locs = await (await fetch(`${url}/rest/v1/locations?select=id,name,lng,lat,elevation,tags,importance&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json();
const routes = await (await fetch(`${url}/rest/v1/routes?select=day_label,stops&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json();
const graph = buildRouteGraph(knowledge as any);
for (const r of routes) {
  console.log(`\n### ${r.day_label}（${r.stops.length} 站）`);
  const issues = routeGraphIssues(r.stops, locs as any, knowledge as any, { allowLongTransfers: r.day_label === "主题游", dayLabel: r.day_label });
  for (const i of issues) console.log(`  [${i.level}] ${i.type}: ${i.message}`);
  const matches = matchLocsToGraph(r.stops, locs as any, graph);
  for (const trail of knowledge.trails) {
    const idx = new Map(trail.stops.map((s: any, k: number) => [String(s.name).trim(), k]));
    const pos = r.stops.map((id: string) => { const n = matches.get(id); return n && idx.has(n.name) ? `${(locs as any).find((l: any)=>l.id===id).name}(${idx.get(n.name)})` : null; }).filter(Boolean);
    if (pos.length >= 2) console.log(`  步道「${trail.name || trail.id}」位置: ${pos.join(" → ")}`);
  }
  const planned = planGraphStops(r.stops, locs as any, knowledge as any);
  const same = JSON.stringify(planned) === JSON.stringify(r.stops);
  console.log(`  规划器重排一致=${same}${!same ? "\n  plan: " + planned.map((id: string)=>((locs as any).find((l: any)=>l.id===id)?.name ?? id)).join(" → ") : ""}`);
}
