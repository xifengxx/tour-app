const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=id,status,is_public,process_report&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
let rep = t.process_report; if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("status:", t.status, "public:", t.is_public, "at:", rep.at, "blocking:", JSON.stringify(rep.gate?.blocking));
console.log((rep.warnings || []).filter((w: string) => /🧮 核心池|📍/.test(w)).join("\n"));
console.log("pool:", JSON.stringify((rep.gate?.diagnostics || []).map((d: any) => `${d.label}:${d.pool}`)));
const rs = await (await fetch(`${url}/rest/v1/routes?select=day_label,stops,sections&tour_id=eq.${t.id}&order=sort_order`, { headers: H })).json();
const locs = await (await fetch(`${url}/rest/v1/locations?select=id,name&tour_id=eq.${t.id}`, { headers: H })).json();
for (const r of rs) {
  console.log(`【${r.day_label}】${r.stops.length}站:`, r.stops.map((id: string) => locs.find((l: any) => l.id === id)?.name ?? id).join("→").slice(0, 200));
  if (r.sections?.length) for (const s of r.sections) console.log(`   ▸ [${s.kind}] ${s.name}（${s.stopIds?.length ?? 0}）`);
}
