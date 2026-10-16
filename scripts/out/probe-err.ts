const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=title,status,is_public&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
console.log(t.title, "| status=", t.status, "| public=", t.is_public);
const rs = await (await fetch(`${url}/rest/v1/routes?select=day_label,stops,sections&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf&order=sort_order`, { headers: H })).json();
const locs = await (await fetch(`${url}/rest/v1/locations?select=id,name&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json();
for (const r of rs) {
  console.log(`【${r.day_label}】${r.stops.length}站:`, r.stops.map((id: string) => locs.find((l: any) => l.id === id)?.name ?? id).join(" → "));
}
