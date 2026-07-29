// Supabase Edge Function: AI 自动处理导览
// 部署: npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag
// Secrets: supabase secrets set DEEPSEEK_API_KEY=sk-... --project-ref qxunedraoviaonjdanag

const GAODE_KEY = "2ff1bf71b26aed0a92eb4ab63657bb25";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SR_KEY = Deno.env.get("SB_SERVICE_ROLE_KEY")!;
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

const hdr = {
  apikey: SR_KEY,
  Authorization: `Bearer ${SR_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function setStatus(tourId: string, status: string) {
  await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}`, {
    method: "PATCH",
    headers: hdr,
    body: JSON.stringify({ status }),
  }).catch(() => {});
}

async function gaode(name: string, city: string) {
  const kw = encodeURIComponent(`${city} ${name}`);
  const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&key=${GAODE_KEY}&types=风景名胜|旅游景点`);
  const d = await r.json();
  if (d.pois?.length) { const [lng, lat] = d.pois[0].location.split(",").map(Number); return { lng, lat }; }
  return null;
}

async function deepseek(messages: { role: string; content: string }[]) {
  const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.7, max_tokens: 8192, response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`DeepSeek: ${r.status}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let tourId: string | undefined;
  try {
    ({ tourId } = await req.json());
    if (!tourId) return json({ error: "Missing tourId" }, 400);

    // 1. Fetch draft (use REST directly since service_role bypasses RLS)
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`, { headers: hdr }).then(r => r.json());
    const tour = Array.isArray(rows) ? rows[0] : rows;
    if (!tour) return json({ error: "Tour not found" }, 404);

    await setStatus(tourId, "processing");

    const destName = tour.destination?.name || "";
    const destRegion = tour.destination?.region || "";
    const src = tour.source?.rawText || "";
    console.log(`Processing: ${tour.title}, ${src.length} chars`);

    // 2. Extract locations
    const lr = await deepseek([
      { role: "system", content: "你是中国旅游规划专家。只返回JSON。" },
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 6000)}\n\n提取所有值得探访的地点。JSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
    ]);

    const locs: any[] = [];
    for (const l of (lr.locations || [])) {
      const c = await gaode(l.name, destRegion);
      locs.push({ id: l.id, name: l.name, lat: c?.lat || 0, lng: c?.lng || 0, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [], sort_order: locs.length });
    }
    console.log(`${locs.length} locations`);

    // 3. Content
    const cr = await deepseek([
      { role: "system", content: "你是文学旅游内容创作者。只返回JSON。" },
      { role: "user", content: `四层内容（📖文学意境/🏛历史掌故/🐉民间传说/🎭地域文化）。\n${locs.map(l => `- ${l.id}: ${l.name}`).join("\n")}\n参考: ${src.slice(0, 4000)}\n\n每层150-250字。JSON: {"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
    ]);
    for (const l of locs) {
      const cd = (cr.locations || []).find((c: any) => c.id === l.id) || {};
      l.layers = cd.layers || {}; l.reflection = cd.reflection || ""; l.practical = cd.practical || {};
    }

    // 4. Routes
    const rr = await deepseek([
      { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
      { role: "user", content: `${destName}路线。地点: ${locs.map(l => `${l.id}:${l.name}`).join(",")}\n\n3条（2日/1日/主题）。JSON: {"routes":[{"id":"r1","day_label":"2日游","title":"","stops":[],"narrative":"","sort_order":0}]}` },
    ]);
    const routes = (rr.routes || []).map((r: any, i: number) => ({ id: r.id, day_label: r.day_label || "", title: r.title, stops: r.stops || [], narrative: r.narrative || "", sort_order: i }));

    // 5. Write
    console.log(`Writing ${locs.length} locs + ${routes.length} routes`);
    await fetch(`${SUPABASE_URL}/rest/v1/locations?tour_id=eq.${tourId}`, { method: "DELETE", headers: hdr });
    await fetch(`${SUPABASE_URL}/rest/v1/routes?tour_id=eq.${tourId}`, { method: "DELETE", headers: hdr });
    for (const l of locs) {
      await fetch(`${SUPABASE_URL}/rest/v1/locations`, { method: "POST", headers: hdr, body: JSON.stringify({ id: l.id, tour_id: tourId, name: l.name, lat: l.lat, lng: l.lng, elevation: l.elevation, importance: l.importance, tags: l.tags, layers: l.layers, reflection: l.reflection, practical: l.practical, sort_order: l.sort_order }) });
    }
    await fetch(`${SUPABASE_URL}/rest/v1/content_layers?tour_id=eq.${tourId}`, { method: "DELETE", headers: hdr });
    for (const ly of [
      { layer_key: "novel", name: "文学意境", icon: "📖", color: "#c0392b", sort_order: 0 },
      { layer_key: "history", name: "历史掌故", icon: "🏛", color: "#d35400", sort_order: 1 },
      { layer_key: "folklore", name: "民间传说", icon: "🐉", color: "#27ae60", sort_order: 2 },
      { layer_key: "customs", name: "地域文化", icon: "🎭", color: "#2980b9", sort_order: 3 },
    ]) { await fetch(`${SUPABASE_URL}/rest/v1/content_layers`, { method: "POST", headers: hdr, body: JSON.stringify({ ...ly, tour_id: tourId }) }); }
    for (const r of routes) { await fetch(`${SUPABASE_URL}/rest/v1/routes`, { method: "POST", headers: hdr, body: JSON.stringify({ id: r.id, tour_id: tourId, day_label: r.day_label, title: r.title, stops: r.stops, narrative: r.narrative, sort_order: r.sort_order }) }); }

    console.log("Done!");
    await setStatus(tourId, "done");
    return json({ success: true, locations: locs.length, routes: routes.length });
  } catch (e: any) {
    console.error(e);
    if (tourId) await setStatus(tourId, "error");
    return json({ error: e.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors() } });
}

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" } as const; }
