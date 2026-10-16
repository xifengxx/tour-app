const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const TOUR = "77a10329-37f8-4a9d-8889-d33cec89ad65";
const rs = await (await fetch(`${url}/rest/v1/routes?select=id,day_label,title,legs&tour_id=eq.${TOUR}`, { headers: H })).json();
for (const r of rs) {
  console.log(`\n【${r.day_label}】${r.title}`);
  for (const l of r.legs || []) {
    const km = l.distanceM != null ? (l.distanceM / 1000).toFixed(1) : "?";
    const h = l.roadMinutes != null ? (l.roadMinutes / 60).toFixed(1) + "h" : "-";
    const flag = (l.roadMinutes ?? 0) > 120 || (l.distanceM ?? 0) > 60000 ? "  ←←← 异常" : "";
    console.log(`  ${l.fromName} → ${l.toName}: ${l.mode} 直线${km}km 推算${h}${l.elevationDeltaM != null ? ` 高差${l.elevationDeltaM}m` : ""}${flag}`);
  }
}
const locs = await (await fetch(`${url}/rest/v1/locations?select=name,lng,lat,elevation,tags&tour_id=eq.${TOUR}`, { headers: H })).json();
console.log("\n地点坐标：");
for (const l of locs) console.log(`  ${l.name} (${l.lng?.toFixed?.(3)},${l.lat?.toFixed?.(3)}) elev="${l.elevation}" ${JSON.stringify(l.tags)}`);
