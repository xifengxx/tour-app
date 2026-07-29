/**
 * Supabase Edge Function — AI 自动处理导览
 *
 * 部署: npx supabase functions deploy process-tour
 * 需要设置 secret: supabase secrets set DEEPSEEK_API_KEY=sk-...
 *
 * 流程:
 *   1. 收到 tourId
 *   2. 读取 Supabase 中的导览草稿
 *   3. 调用 DeepSeek API: 提取地点 → 生成内容 → 规划路线
 *   4. 调用高德 API 查坐标
 *   5. 写入 Supabase
 */

const GAODE_KEY = "2ff1bf71b26aed0a92eb4ab63657bb25";

// Supabase REST API
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY")!;

const supabaseHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function fetchGaodeCoord(name: string, city: string) {
  const kw = encodeURIComponent(`${city || ""} ${name}`);
  const url = `https://restapi.amap.com/v3/place/text?keywords=${kw}&key=${GAODE_KEY}&types=风景名胜|旅游景点`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.pois && data.pois.length > 0) {
    const [lng, lat] = data.pois[0].location.split(",").map(Number);
    return { lng, lat };
  }
  return null;
}

async function callDeepSeek(messages: Array<{ role: string; content: string }>) {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      temperature: 0.7,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${err.substring(0, 300)}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

Deno.serve(async (req: Request) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { tourId } = await req.json();
    if (!tourId) {
      return new Response(JSON.stringify({ error: "Missing tourId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // ── 1. Fetch tour draft ──
    const tourRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`,
      { headers: supabaseHeaders }
    );
    const tours = await tourRes.json();
    if (!tours || tours.length === 0) {
      return new Response(JSON.stringify({ error: "Tour not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    const tour = tours[0];
    const destName = tour.destination?.name || "";
    const destRegion = tour.destination?.region || "";
    const sourceText = tour.source?.rawText || "";

    console.log(`Processing: ${tour.title}, source: ${sourceText.length} chars`);

    // ── 2. Extract locations ──
    const locResult = await callDeepSeek([
      {
        role: "system",
        content: "你是一个专业的中国旅游规划专家，熟悉文学和历史景点。只返回JSON，不要其他文字。",
      },
      {
        role: "user",
        content: `根据以下文本提取所有值得实地探访的地点。

目的地：${destName}（${destRegion}）
文本：${sourceText.substring(0, 6000)}

返回JSON：
{
  "locations": [
    {"id": "拼音id", "name": "地点名", "importance": 1-5, "elevation": "海拔", "tags": ["标签"]}
  ]
}`,
      },
    ]);

    const rawLocations = locResult.locations || [];
    console.log(`Found ${rawLocations.length} locations`);

    // ── 3. Look up coordinates ──
    const locations: Array<Record<string, unknown>> = [];
    for (const loc of rawLocations) {
      const coord = await fetchGaodeCoord(loc.name, destRegion);
      locations.push({
        id: loc.id,
        name: loc.name,
        lat: coord?.lat || 0,
        lng: coord?.lng || 0,
        elevation: loc.elevation || "",
        importance: loc.importance || 3,
        tags: loc.tags || [],
        sort_order: locations.length,
      });
    }

    // ── 4. Generate content ──
    const contentResult = await callDeepSeek([
      {
        role: "system",
        content: "你是一个专业的文学旅游内容创作者，擅长写有温度、有故事感的景点介绍。只返回JSON。",
      },
      {
        role: "user",
        content: `为以下地点生成四层内容（文学意境📖/历史掌故🏛/民间传说🐉/地域文化🎭）。

地点：${locations.map((l) => `- ${l.id}: ${l.name}`).join("\n")}
参考文本：${sourceText.substring(0, 4000)}

每层150-250字，要有故事性和具体细节。每个地点加reflection（15-30字反思问题）和practical（access/difficulty/bestTime/tip）。

返回JSON：
{
  "locations": [
    {
      "id": "地点id",
      "layers": {"novel":{"text":"..."},"history":{"text":"..."},"folklore":{"text":"..."},"customs":{"text":"..."}},
      "reflection": "反思",
      "practical": {"access":"","difficulty":"","bestTime":"","tip":""}
    }
  ]
}`,
      },
    ]);

    const contentData = (contentResult.locations || []) as Array<Record<string, unknown>>;
    for (const loc of locations) {
      const cd = contentData.find((c) => c.id === loc.id) || {};
      loc.layers = cd.layers || {};
      loc.reflection = cd.reflection || "";
      loc.practical = cd.practical || {};
    }

    // ── 5. Plan routes ──
    const routeResult = await callDeepSeek([
      { role: "system", content: "你是一个专业的旅游路线规划师。只返回JSON。" },
      {
        role: "user",
        content: `规划${destName}的游览路线。地点：${locations.map((l) => `- ${l.id}: ${l.name}`).join("\n")}

规划3条路线（完整2日/精简1日/主题），返回JSON：
{
  "routes": [
    {"id":"r1","day":"2日游","title":"","stops":["id1","id2"],"narrative":"","sort_order":0},
    {"id":"r2","day":"1日游","title":"","stops":["id1"],"narrative":"","sort_order":1},
    {"id":"r3","day":"主题","title":"","stops":["id2"],"narrative":"","sort_order":2}
  ]
}`,
      },
    ]);

    const routes = (routeResult.routes || []).map((r: Record<string, unknown>, i: number) => ({
      id: r.id,
      day: r.day || "",
      title: r.title,
      stops: r.stops || [],
      narrative: r.narrative || "",
      sort_order: i,
    }));

    // ── 6. Write to Supabase ──
    console.log(`Writing ${locations.length} locations + ${routes.length} routes`);

    // Delete old
    await fetch(`${SUPABASE_URL}/rest/v1/locations?tour_id=eq.${tourId}`, {
      method: "DELETE", headers: supabaseHeaders,
    });
    await fetch(`${SUPABASE_URL}/rest/v1/routes?tour_id=eq.${tourId}`, {
      method: "DELETE", headers: supabaseHeaders,
    });

    // Insert locations
    for (const loc of locations) {
      await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
        method: "POST",
        headers: supabaseHeaders,
        body: JSON.stringify({
          id: loc.id,
          tour_id: tourId,
          name: loc.name,
          lat: loc.lat,
          lng: loc.lng,
          elevation: loc.elevation || "",
          importance: loc.importance || 3,
          tags: loc.tags || [],
          layers: loc.layers || {},
          reflection: loc.reflection || "",
          practical: loc.practical || {},
          sort_order: loc.sort_order || 0,
        }),
      });
    }

    // Insert content_layers
    const layerDefs = [
      { layer_key: "novel", name: "文学意境", icon: "📖", color: "#c0392b", sort_order: 0 },
      { layer_key: "history", name: "历史掌故", icon: "🏛", color: "#d35400", sort_order: 1 },
      { layer_key: "folklore", name: "民间传说", icon: "🐉", color: "#27ae60", sort_order: 2 },
      { layer_key: "customs", name: "地域文化", icon: "🎭", color: "#2980b9", sort_order: 3 },
    ];

    await fetch(`${SUPABASE_URL}/rest/v1/content_layers?tour_id=eq.${tourId}`, {
      method: "DELETE", headers: supabaseHeaders,
    });

    for (const layer of layerDefs) {
      await fetch(`${SUPABASE_URL}/rest/v1/content_layers`, {
        method: "POST",
        headers: supabaseHeaders,
        body: JSON.stringify({ ...layer, tour_id: tourId }),
      });
    }

    // Insert routes
    for (const route of routes) {
      await fetch(`${SUPABASE_URL}/rest/v1/routes`, {
        method: "POST",
        headers: supabaseHeaders,
        body: JSON.stringify({
          id: route.id,
          tour_id: tourId,
          day_label: route.day,
          title: route.title,
          stops: route.stops,
          narrative: route.narrative,
          sort_order: route.sort_order,
        }),
      });
    }

    console.log("Done!");

    return new Response(
      JSON.stringify({ success: true, locations: locations.length, routes: routes.length }),
      { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }
});
