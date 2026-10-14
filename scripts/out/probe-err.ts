const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const t = await (await fetch(`${url}/rest/v1/tours?select=title,status,process_error&order=updated_at.desc&limit=10`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json();
for (const x of t) if (x.process_error) console.log(x.title, "|", x.status, "|", String(x.process_error).slice(0, 400));
