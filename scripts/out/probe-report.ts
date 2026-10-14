const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const r = await fetch(`${url}/rest/v1/tours?select=process_error,updated_at&order=created_at.desc&limit=16`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
for (const t of await r.json()) if (t.process_error) console.log(t.updated_at, "|", JSON.stringify(t.process_error).slice(0, 500), "\n");
