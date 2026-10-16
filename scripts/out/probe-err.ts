const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=process_report&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
let rep = t.process_report; if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
for (const k of Object.keys(rep)) {
  const v = JSON.stringify(rep[k]);
  console.log(`${k}: ${v.length > 300 ? v.slice(0, 300) + "…" : v}`);
}
