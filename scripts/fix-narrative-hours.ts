// v98：一次性修复存量文案里的错误车程数字。
// 根因是提示词换算公式把分钟当 0.1 小时输出（32 分钟 → "约5.3小时"），
// AI 忠实照抄。函数已修 + 写库链路已加确定性校验，这里只处理**已入库**的
// narrative/sections：用 routes.legs 里存的 roadMinutes/duration 真值就地改写。
// 默认 dry-run 只列差异；--apply 才 PATCH。
import { repairTransportHours } from "../supabase/functions/process-tour/route-graph.ts";
import type { RouteLeg } from "../supabase/functions/process-tour/route-graph.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL") || "";
const TOKEN = Deno.env.get("SERVICE_ROLE_KEY") || "";
if (!SUPABASE_URL || !TOKEN) { console.error("需要 VITE_SUPABASE_URL + SERVICE_ROLE_KEY"); Deno.exit(1); }
const apply = Deno.args.includes("--apply");
const H = { apikey: TOKEN, Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const tours = await (await fetch(`${SUPABASE_URL}/rest/v1/tours?select=id,title,is_public&order=title`, { headers: H })).json();
let changed = 0;
for (const t of tours) {
  const routes = await (await fetch(`${SUPABASE_URL}/rest/v1/routes?select=id,day_label,narrative,sections,legs&tour_id=eq.${t.id}`, { headers: H })).json();
  for (const r of routes) {
    const legs = (r.legs || []) as RouteLeg[];
    if (!legs.length) continue;
    const patches: Record<string, unknown> = {};
    const notes: string[] = [];
    const nr = repairTransportHours(String(r.narrative || ""), legs);
    if (nr.fixes.length) { patches.narrative = nr.text; notes.push(...nr.fixes); }
    if (Array.isArray(r.sections) && r.sections.length) {
      let secChanged = false;
      const sections = r.sections.map((sec: any) => {
        if (!sec?.text) return sec;
        const sr = repairTransportHours(String(sec.text), legs);
        if (!sr.fixes.length) return sec;
        secChanged = true;
        notes.push(...sr.fixes.map((f: string) => `[${sec.name}] ${f}`));
        return { ...sec, text: sr.text };
      });
      if (secChanged) patches.sections = sections;
    }
    if (!Object.keys(patches).length) continue;
    changed++;
    console.log(`\n${t.title} · ${r.day_label}${apply ? "（已修复）" : "（待修复）"}`);
    for (const n of notes) console.log("  ·", n);
    if (apply) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/routes?id=eq.${r.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(patches) });
      if (!res.ok) console.error("  PATCH 失败", res.status, await res.text());
    }
  }
}
console.log(`\n${apply ? "已" : "待"}修复 ${changed} 条路线。${apply ? "" : "确认无误后加 --apply。"}`);
