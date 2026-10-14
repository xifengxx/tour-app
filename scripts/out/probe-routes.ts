const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const wanted = ["北岳恒山", "青城山", "武汉东湖", "武汉龟山"];
const tours = await (await fetch(`${url}/rest/v1/tours?select=id,title,status,is_public&order=updated_at.desc&limit=30`, { headers: H })).json();
for (const t of tours) {
  if (!wanted.some(w => t.title.includes(w))) continue;
  console.log(`\n### ${t.title} | status=${t.status} | public=${t.is_public}`);
  const rs = await (await fetch(`${url}/rest/v1/routes?select=day_label,stops,sections&tour_id=eq.${t.id}&order=sort_order`, { headers: H })).json();
  for (const r of rs) {
    console.log(`【${r.day_label}】${r.stops.length} 站`);
    if (r.sections?.length) for (const s of r.sections) console.log(`  ▸ [${s.kind}] ${s.name}（${s.stopIds?.length ?? 0}）`);
  }
}
