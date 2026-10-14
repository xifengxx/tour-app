const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const tours = await (await fetch(`${url}/rest/v1/tours?select=id,title,process_report&order=updated_at.desc&limit=30`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })).json();
for (const t of tours) {
  if (!/青城山|东湖|恒山/.test(t.title)) continue;
  let rep = t.process_report;
  if (typeof rep === "string") try { rep = JSON.parse(rep); } catch {}
  console.log(`\n### ${t.title}`);
  const ws = (rep?.warnings || []).filter((x: string) => /主题游|地区|并入|🏷|锚点|行政区|容量|🚫|阻断|闸门|review/.test(x));
  console.log(ws.slice(0, 24).join("\n") || "（无相关告警）");
  const gate = rep?.gate;
  if (gate) console.log("blocking:", JSON.stringify(gate.blocking), "| write:", JSON.stringify((gate.writeStage || []).map((x: any) => `${x.label}:${x.stops}`)));
}
