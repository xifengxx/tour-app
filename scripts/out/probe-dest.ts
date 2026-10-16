const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=destination,process_report&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
let rep = t.process_report; if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("destination:", JSON.stringify(t.destination));
console.log("diagnostics:", JSON.stringify(rep.gate?.diagnostics));
const locs = await (await fetch(`${url}/rest/v1/locations?select=name,lng,lat,tags,importance&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json();
for (const l of locs) console.log(` ${l.name} (${l.lng.toFixed(3)},${l.lat.toFixed(3)}) imp${l.importance}${(l.tags||[]).includes("地区景点") ? " [reg]" : ""}`);
