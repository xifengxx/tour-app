const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const tours = await (await fetch(`${url}/rest/v1/tours?select=id,title,status,is_public&id=eq.1aa0b067-7082-47e4-a39f-4db35426b8d6`, { headers: H })).json();
const t = tours[0];
console.log(`${t.title} | status=${t.status} | public=${t.is_public}`);
const rs = await (await fetch(`${url}/rest/v1/routes?select=day_label,title,stops,sections,narrative&tour_id=eq.${t.id}&order=sort_order`, { headers: H })).json();
for (const r of rs) {
  console.log(`\n【${r.day_label}】${r.title} — ${r.stops.length} 站`);
  if (r.sections?.length) {
    for (const s of r.sections) console.log(`  ▸ [${s.kind}] ${s.name}（${s.stopIds?.length ?? 0} 站）${s.text ? "：" + String(s.text).slice(0, 60) + "…" : "（无分区文案）"}`);
  }
  if (r.narrative) console.log(`  narrative: ${String(r.narrative).slice(0, 150)}…`);
}
