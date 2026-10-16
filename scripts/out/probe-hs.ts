const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = await (await fetch(`${url}/rest/v1/tours?select=id,title,destination,status&order=updated_at.desc&limit=30`, { headers: H })).json();
for (const x of t) console.log(String(x.destination?.name ?? ""), "|", x.title, "|", x.status);
