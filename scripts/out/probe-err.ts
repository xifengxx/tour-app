const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const t = (await (await fetch(`${url}/rest/v1/tours?select=process_report&id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json())[0];
let rep = t.process_report;
if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("coreScenic:", rep.coreScenic, "| mainScenic:", rep.mainScenic);
console.log("diagnostics:", JSON.stringify(rep.gate?.diagnostics, null, 1).slice(0, 1800));
console.log("blocking:", JSON.stringify(rep.gate?.blocking));
console.log((rep.warnings || []).filter((w: string) => /🏷|锚点|⛰|🔒|🧭.*回退|闸/.test(w)).join("\n"));
