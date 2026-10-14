const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const r = await fetch(`${url}/rest/v1/tours?select=process_report,id=eq.1aa0b067-7082-47e4-a39f-4db35426b8d6`.replace(",id=eq", "&id=eq"), { headers: { apikey: key, Authorization: `Bearer ${key}` } });
let rep = (await r.json())[0].process_report;
if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("at:", rep.at, "| tier:", rep.knowledgeTier, "| plans:", rep.plans, "| routes:", rep.routes);
console.log("gate:", JSON.stringify(rep.gate?.writeStage, null, 1));
console.log("diagnostics:", JSON.stringify(rep.gate?.diagnostics, null, 1).slice(0, 2400));
console.log("repairs:", JSON.stringify((rep.warnings || []).filter((w: string) => /♻️ 路线|🚫|容量|削|剔除/.test(w)), null, 1).slice(0, 1800));
