// v99.9：两条静态演示导览（剑出衡山/笑傲华山）迁入数据库。
// 忠实迁移（保留手工内容），不走生成管线；迁入后即拥有正式身份：
// 可编辑、可确认、可重跑、进审核页。幂等：同名导览已存在则跳过。
const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
if (!url || !key) { console.error("需要 VITE_SUPABASE_URL + SERVICE_ROLE_KEY"); Deno.exit(1); }
const USER = "48680e38-fc2b-4963-adb5-3e86c27b4cb9";
const apply = Deno.args.includes("--apply");
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

const FILES = [
  { slug: "nanyue-hengshan", file: "public/data/henshan.json" },
  { slug: "huashan-xiaoao", file: "public/data/huashan.json" },
];

const existing = await (await fetch(`${url}/rest/v1/tours?select=id,title&user_id=eq.${USER}`, { headers: H })).json();
const results: Record<string, string> = {};
for (const { slug, file } of FILES) {
  const d = JSON.parse(Deno.readTextFileSync(file));
  const title = d.meta.title;
  const dup = existing.find((t: any) => t.title === title);
  if (dup) { console.log(`跳过（已存在）：${title} → /tour/${dup.id}`); results[slug] = dup.id; continue; }
  console.log(`\n### ${title}`);
  if (!apply) { console.log("  （dry-run，加 --apply 写入）"); continue; }
  const tourRow = {
    user_id: USER, title, subtitle: d.meta.subtitle || "",
    theme: d.meta.theme || {}, source: { ...(d.source || {}), rawText: (d.source as any)?.synopsis || "" },
    destination: { ...(d.destination || {}), type: (d.destination as any)?.type || "mountain" },
    is_public: true, status: "done",
    process_report: { migratedFromStaticSlug: slug, migratedAt: new Date().toISOString(), note: "静态演示导览忠实迁入，未经生成管线" },
  };
  const tr = await (await fetch(`${url}/rest/v1/tours`, { method: "POST", headers: H, body: JSON.stringify(tourRow) })).json();
  const tourId = tr[0]?.id;
  if (!tourId) { console.error("  tours 插入失败", JSON.stringify(tr).slice(0, 300)); continue; }
  const scope = tourId.slice(0, 8);
  const idMap = new Map((d.locations || []).map((l: any) => [l.id, `${scope}-${l.id}`]));
  const locs = (d.locations || []).map((l: any, i: number) => ({
    id: idMap.get(l.id), tour_id: tourId, name: l.name, lat: l.lat, lng: l.lng,
    elevation: l.elevation || "", importance: l.importance ?? 3, tags: l.tags || [],
    layers: l.layers || {}, reflection: l.reflection || "", practical: l.practical || {}, sort_order: i,
  }));
  const layers = (d.contentLayers || []).map((c: any, i: number) => ({ tour_id: tourId, layer_key: c.id, name: c.name, icon: c.icon || "", color: c.color || "", sort_order: i }));
  const routes = (d.routes || []).map((r: any, i: number) => ({
    id: `${scope}-r${i + 1}`, tour_id: tourId, day_label: r.day || r.day_label || `第${i + 1}天`, title: r.title,
    stops: (r.stops || []).map((s: string) => idMap.get(s) || s), narrative: r.narrative || "",
    sort_order: i, legs: r.legs || [], prof: r.prof || [], sections: r.sections || [], path: r.path || null,
  }));
  const tips = (d.tips || []).map((text: string) => ({ tour_id: tourId, text }));
  for (const [table, rows] of [["locations", locs], ["content_layers", layers], ["routes", routes], ["tips", tips]] as const) {
    if (!rows.length) continue;
    const res = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers: H, body: JSON.stringify(rows) });
    if (!res.ok) console.log(`  ${table} 写入失败`, res.status, (await res.text()).slice(0, 200));
    else console.log(`  ${table}: ${rows.length} 行 ✓`);
  }
  console.log(`  → /tour/${tourId}`);
  results[slug] = tourId;
}
if (apply && Object.keys(results).length) {
  Deno.writeTextFileSync("scripts/out/static-import-map.json", JSON.stringify(results, null, 2));
  console.log("\n映射已写 scripts/out/static-import-map.json");
}
