// v99.8：全库扫描"有路径/有站点但剖面为空"的路线，节流重采补齐。
// 用法：set -a && . ./.env && set +a && deno run --allow-net --allow-read --allow-write --allow-env scripts/backfill-prof.ts [--apply]
import { elevationProfile } from "../supabase/functions/process-tour/elevation.ts";
const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
if (!url || !key) { console.error("需要 VITE_SUPABASE_URL + SERVICE_ROLE_KEY"); Deno.exit(1); }
const apply = Deno.args.includes("--apply");
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const tours = await (await fetch(`${url}/rest/v1/tours?select=id,title&order=title`, { headers: H })).json();
let fixed = 0;
for (const t of tours) {
  const rs = await (await fetch(`${url}/rest/v1/routes?select=id,day_label,prof,path,stops&tour_id=eq.${t.id}`, { headers: H })).json();
  const locs = await (await fetch(`${url}/rest/v1/locations?select=id,lng,lat&tour_id=eq.${t.id}`, { headers: H })).json();
  for (const r of rs) {
    if (r.prof && r.prof.length >= 2) continue;
    const coords = r.path?.geom?.length > 1
      ? r.path.geom.map(([lng, lat]: number[]) => ({ lng, lat }))
      : (r.stops || []).map((id: string) => locs.find((l: any) => l.id === id)).filter((l: any) => l?.lat && l?.lng).map((l: any) => ({ lng: l.lng, lat: l.lat }));
    if (coords.length < 2) { console.log(`  跳过 ${t.title}/${r.day_label}：无几何可采样`); continue; }
    await new Promise((s) => setTimeout(s, 2500)); // OTD 免费档 1req/s，节流
    const prof = await elevationProfile(coords as any, 100);
    if (!prof || prof.length < 2) { console.log(`  ✗ 仍失败 ${t.title}/${r.day_label}`); continue; }
    fixed++;
    console.log(`  ${apply ? "已补" : "待补"} ${t.title}/${r.day_label}: ${prof.length}点 ${prof[0].m}→${prof.at(-1)!.m}m`);
    if (apply) {
      const res = await fetch(`${url}/rest/v1/routes?id=eq.${r.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ prof }) });
      if (!res.ok) console.log("    PATCH 失败", res.status, await res.text());
    }
  }
}
console.log(`\n${apply ? "已补齐" : "待补齐"} ${fixed} 条。${apply ? "" : "确认后加 --apply。"}`);
