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

// Write helper — fetch does NOT throw on 4xx/5xx, so check res.ok explicitly.
// (An earlier version silently dropped all writes when a payload was malformed.)
async function postRows(table: string, rows: any[]) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: hdr,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
}

async function deleteRows(table: string, tourId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?tour_id=eq.${tourId}`, {
    method: "DELETE",
    headers: hdr,
  });
  if (!res.ok) throw new Error(`DELETE ${table}: ${res.status} ${await res.text()}`);
}

async function gaode(name: string, city: string) {
  const kw = encodeURIComponent(`${city} ${name}`);
  const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&key=${GAODE_KEY}&types=风景名胜|旅游景点`);
  const d = await r.json();
  if (d.pois?.length) { const [lng, lat] = d.pois[0].location.split(",").map(Number); return { lng, lat, name: d.pois[0].name }; }
  return null;
}

// Regeo: verify a coordinate is actually in the expected city/province
async function regeo(lng: number, lat: number) {
  const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${GAODE_KEY}`);
  const d = await r.json();
  if (d.status === "1" && d.regeocode?.addressComponent) {
    const ac = d.regeocode.addressComponent;
    return { province: ac.province, city: ac.city, district: ac.district, adcode: ac.adcode };
  }
  return null;
}

// Check if a location is plausibly in the expected region
function regionMatch(geo: { province: string; city: string }, targetRegion: string): boolean {
  if (!geo) return false;
  // Extract city/province keywords from target region (e.g., "湖北省武汉市" → ["湖北","武汉"])
  const kw = targetRegion.replace(/[省市自治区]$/g, "");
  const cityPart = geo.city || geo.province || "";
  const provPart = geo.province || "";
  return cityPart.includes(kw) || kw.includes(cityPart) || provPart.includes(kw);
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

    const warnings: string[] = [];
    const locs: any[] = [];
    for (const l of (lr.locations || [])) {
      const c = await gaode(l.name, destRegion);
      if (!c || !c.lat) {
        warnings.push(`⚠️ "${l.name}" 未找到坐标，已跳过`);
        continue;
      }
      // Verify coordinate is in the target region
      const geo = await regeo(c.lng, c.lat);
      if (geo && !regionMatch(geo, destRegion)) {
        warnings.push(`⚠️ "${l.name}" 坐标(${c.lng},${c.lat})位于 ${geo.province}${geo.city || ''}，不在 ${destRegion}，已跳过`);
        continue;
      }
      // Use Gaode's official name if available
      const displayName = c.name && c.name !== l.name ? c.name : l.name;
      locs.push({ id: l.id, name: displayName, lat: c.lat, lng: c.lng, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [], sort_order: locs.length });
    }
    console.log(`${locs.length} locations (${warnings.length} warnings)`);

    // 3. Content
    const cr = await deepseek([
      { role: "system", content: "你是文学旅游内容创作者。只返回JSON。" },
      { role: "user", content: `四层内容（📖文学意境/🏛历史掌故/🐉民间传说/🎭地域文化）。\n${locs.map(l => `- ${l.id}: ${l.name}`).join("\n")}\n参考: ${src.slice(0, 4000)}\n\n每层150-250字。JSON: {"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
    ]);
    for (const l of locs) {
      const cd = (cr.locations || []).find((c: any) => c.id === l.id) || {};
      l.layers = cd.layers || {}; l.reflection = cd.reflection || ""; l.practical = cd.practical || {};
    }

    // DeepSeek ids (slugs like "r1", "yujing-feng") are NOT globally unique,
    // but locations.id / routes.id are global primary keys. Scope them per tour
    // or writes collide with other tours (409 duplicate key).
    const scope = tourId.slice(0, 8);
    const slugToDbId = new Map(locs.map(l => [l.id, `${scope}-${l.id}`]));

    // DeepSeek's route step may reference stops by slug, Chinese name, or a
    // variant ("玉京峰景区") — resolve all of these back to the location db id.
    const resolveStop = (s: any) => {
      const key = String(s).trim();
      if (!key) return undefined;
      if (slugToDbId.has(key)) return slugToDbId.get(key);
      const hit = locs.find(l => l.name === key || key.includes(l.name) || l.name.includes(key));
      return hit ? slugToDbId.get(hit.id) : undefined;
    };

    // 4. Routes
    const rr = await deepseek([
      { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
      { role: "user", content: `${destName}路线。可选地点（id: 名称）: ${locs.map(l => `${l.id}: ${l.name}`).join(", ")}\n\n规划3条路线（2日游/1日游/主题游）。注意：stops 必须是由上面地点的 id 组成的字符串数组，如 ["yujing-feng","sanqing-palace"]，严禁返回对象或使用地点以外的 id。JSON: {"routes":[{"day_label":"2日游","title":"","stops":["id1","id2"],"narrative":""}]}` },
    ]);
    // Route stop validation: resolve and report mismatches
    const routes = (rr.routes || []).map((r: any, i: number) => {
      const rawStops: string[] = (Array.isArray(r.stops) ? r.stops : [])
        .map((s: any) => s && typeof s === "object" ? (s.poi ?? s.id ?? s.name) : s)
        .filter(Boolean);
      const resolved = rawStops.map((s: string) => resolveStop(s)).filter(Boolean);
      const unresolved = rawStops.filter((_, j) => !resolved[j]);
      if (unresolved.length > 0) {
        warnings.push(`⚠️ 路线"${r.title || r.day_label || `路线${i+1}`}"有 ${unresolved.length} 个站点无法匹配：${unresolved.join(', ')}`);
      }
      return {
        id: `${scope}-r${i + 1}`,
        day_label: String(r.day_label || ""),
        title: String(r.title || `路线${i + 1}`),
        stops: resolved,
        narrative: typeof r.narrative === "string" ? r.narrative : "",
        sort_order: i,
      };
    }).filter(r => r.stops.length > 0);

    // 5. Write
    console.log(`Writing ${locs.length} locs + ${routes.length} routes`);
    await deleteRows("locations", tourId);
    await deleteRows("routes", tourId);
    await postRows("locations", locs.map(l => ({ id: slugToDbId.get(l.id), tour_id: tourId, name: l.name, lat: l.lat, lng: l.lng, elevation: l.elevation, importance: l.importance, tags: l.tags, layers: l.layers, reflection: l.reflection, practical: l.practical, sort_order: l.sort_order })));
    await deleteRows("content_layers", tourId);
    await postRows("content_layers", [
      { layer_key: "novel", name: "文学意境", icon: "📖", color: "#c0392b", sort_order: 0 },
      { layer_key: "history", name: "历史掌故", icon: "🏛", color: "#d35400", sort_order: 1 },
      { layer_key: "folklore", name: "民间传说", icon: "🐉", color: "#27ae60", sort_order: 2 },
      { layer_key: "customs", name: "地域文化", icon: "🎭", color: "#2980b9", sort_order: 3 },
    ].map(ly => ({ ...ly, tour_id: tourId })));
    await postRows("routes", routes.map(r => ({ id: r.id, tour_id: tourId, day_label: r.day_label, title: r.title, stops: r.stops, narrative: r.narrative, sort_order: r.sort_order })));

    // Quality report
    const report = {
      locations: locs.length,
      routes: routes.length,
      warnings: warnings.length > 0 ? warnings : undefined,
      rejected: (lr.locations || []).length - locs.length, // locations rejected by regeo
    };
    console.log(`Done! ${report.locations} locs, ${report.routes} routes, ${warnings.length} warnings`);
    await setStatus(tourId, "done");
    return json({ success: true, ...report });
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
