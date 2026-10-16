const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=status,process_report&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
let rep = t.process_report; if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("status:", t.status, "| at:", rep.at);
console.log((rep.warnings || []).filter((w: string) => /🧮 核心池|回退|隔断/.test(w)).join("\n"));
console.log("pool:", JSON.stringify((rep.gate?.diagnostics || []).map((d: any) => `${d.label}:${d.pool}`)));
