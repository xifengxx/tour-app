const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const tours = await (await fetch(`${url}/rest/v1/tours?select=title,process_report&order=updated_at.desc&limit=30`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json();
const t = tours.find(x => x.title.includes("青城山"))!;
let rep = t.process_report;
if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
console.log("地点:", rep.locations, "| plans:", rep.plans, "| routes:", rep.routes);
console.log((rep.warnings || []).filter((w: string) => /地区|主题|并入|都江堰|行政区|🏷|闸|抑制|🔐/.test(w)).join("\n") || "无相关");
