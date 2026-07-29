/**
 * Vercel Serverless Function — AI 自动处理导览
 *
 * POST /api/process-tour  { tourId }
 *
 * 流程：
 *   1. 读取 Supabase 中的导览草稿
 *   2. 调用 DeepSeek API 提取地点 + 查坐标 + 生成四层内容 + 规划路线
 *   3. 写入 Supabase（locations, content_layers, routes）
 *
 * 部署时需在 Vercel 添加环境变量：DEEPSEEK_API_KEY
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

function supabaseHeaders(userToken) {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${userToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const GAODE_KEY = '2ff1bf71b26aed0a92eb4ab63657bb25';


async function fetchGaodeCoord(name, city) {
  const kw = encodeURIComponent(`${city || ''} ${name}`);
  const url = `https://restapi.amap.com/v3/place/text?keywords=${kw}&key=${GAODE_KEY}&types=风景名胜|旅游景点`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.pois && data.pois.length > 0) {
    const [lng, lat] = data.pois[0].location.split(',').map(Number);
    return { lng, lat, address: data.pois[0].name };
  }
  return null;
}

async function callDeepSeek(messages, jsonMode = true) {
  const body = {
    model: 'deepseek-chat',
    messages,
    temperature: 0.7,
    max_tokens: 8192,
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${DEEPSEEK_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`DeepSeek API error: ${res.status} ${err.substring(0, 300)}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { tourId } = req.body || {};
  if (!tourId) {
    return res.status(400).json({ error: 'Missing tourId' });
  }

  // Extract user's JWT from request
  const authHeader = req.headers.authorization || '';
  const userToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const headers = supabaseHeaders(userToken);

  try {
    // ── 1. Fetch tour draft ──
    const tourRes = await fetch(
      `${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`,
      { headers }
    );
    const tours = await tourRes.json();
    if (!tours || tours.length === 0) {
      return res.status(404).json({ error: 'Tour not found' });
    }
    const tour = tours[0];
    const destName = tour.destination?.name || '';
    const destRegion = tour.destination?.region || '';
    const sourceText = tour.source?.rawText || '';
    const novelTitle = tour.source?.title || '';
    const novelAuthor = tour.source?.author || '';

    console.log(`Processing tour: ${tour.title}, source length: ${sourceText.length}`);

    // ── 2. Step 1: Extract locations ──
    const locPrompt = `你是一个文学旅游规划专家。根据以下文本，提取所有值得实地探访的地点。

目的地：${destName}（${destRegion}）
文本内容：${sourceText.substring(0, 6000)}

请返回JSON格式（只返回JSON，不要其他文字）：
{
  "locations": [
    {
      "id": "拼音-英文id",
      "name": "地点名",
      "importance": 1-5的数字（5最重要）,
      "elevation": "海拔高度（如'1545m'，不确定写''）",
      "tags": ["标签1", "标签2"],
      "reason": "为什么值得去，与文本的关联"
    }
  ]
}`;

    const locResult = await callDeepSeek([
      { role: 'system', content: '你是一个专业的中国旅游规划专家，熟悉文学和历史景点。只返回JSON。' },
      { role: 'user', content: locPrompt },
    ]);

    const rawLocations = locResult.locations || [];
    console.log(`Found ${rawLocations.length} locations`);

    // ── 3. Step 2: Look up coordinates ──
    const locations = [];
    for (const loc of rawLocations) {
      const coord = await fetchGaodeCoord(loc.name, destRegion);
      locations.push({
        id: loc.id,
        name: loc.name,
        lat: coord?.lat || 0,
        lng: coord?.lng || 0,
        elevation: loc.elevation || '',
        importance: loc.importance || 3,
        tags: loc.tags || [],
        sort_order: locations.length,
      });
      console.log(`  ${loc.name} → ${coord ? `${coord.lng},${coord.lat}` : 'no coord'}`);
    }

    // ── 4. Step 3: Generate content layers ──
    const contentPrompt = `你是一个文学旅游内容创作者。为以下地点生成四层内容。

目的地类型：${tour.destination?.type || 'mountain'}
${tour.destination?.type === 'mountain' || !tour.destination?.type ? `
第1层：文学意境 📖 — 与小说/文本中此地的关联场景、原文引用
第2层：历史掌故 🏛 — 此地的真实历史事件和人物
第3层：民间传说 🐉 — 当地的民间故事和神话
第4层：地域文化 🎭 — 当地民俗、饮食、风土人情
` : `
第1层：历史现场 🏛 — 历史事件在此地的具体发生场景
第2层：帝王足迹 👑 — 相关帝王的事迹和遗迹
第3层：民间传说 🐉 — 当地的民间故事和神话
第4层：考古发现 ⛏ — 此地的考古发现和学术价值
`}

地点列表：
${locations.map(l => `- ${l.name} (重要性: ${l.importance}/5)`).join('\n')}

源文本参考：${sourceText.substring(0, 4000)}

对每个地点，每层写150-250字，要求有故事性、具体细节、有人情味，不要写百科词条式的说明。
为每个地点写一句reflection（引导读者在此地思考的问题，15-30字）。
为每个地点写practical（到达方式、难度、最佳时间、贴士，每个10-20字）。

返回JSON（只返回JSON）：
{
  "locations": [
    {
      "id": "地点id",
      "layers": {
        "novel": {"text": "第一层内容"},
        "history": {"text": "第二层内容"},
        "folklore": {"text": "第三层内容"},
        "customs": {"text": "第四层内容"}
      },
      "reflection": "反思问题",
      "practical": {"access": "到达方式", "difficulty": "难度", "bestTime": "最佳时间", "tip": "贴士"}
    }
  ]
}`;

    const contentResult = await callDeepSeek([
      { role: 'system', content: '你是一个专业的文学旅游内容创作者，擅长写有温度、有故事感的景点介绍。只返回JSON。' },
      { role: 'user', content: contentPrompt },
    ]);

    const contentData = contentResult.locations || [];

    // Merge content into locations
    for (const loc of locations) {
      const cd = contentData.find(c => c.id === loc.id) || {};
      loc.layers = cd.layers || {
        novel: { text: '' },
        history: { text: '' },
        folklore: { text: '' },
        customs: { text: '' },
      };
      loc.reflection = cd.reflection || '';
      loc.practical = cd.practical || {};
    }

    // ── 5. Step 4: Plan routes ──
    const routePrompt = `为以下地点规划游览路线。

目的地：${destName}（${destRegion}）
地点列表：${locations.map(l => `- ${l.id}: ${l.name} (重要性${l.importance})`).join('\n')}

规划2-3条路线：
- 路线1：完整路线（主要地点，2日游）
- 路线2：精简路线（核心4-6个地点，1日游）
- 路线3：主题路线（根据目的地特点：日出/文化/亲子）

每条路线包含 stops 数组（用location的id），narrative写50-100字的路线描述。

返回JSON（只返回JSON）：
{
  "routes": [
    {"id": "route-full", "day": "2日游", "title": "路线名", "stops": ["id1","id2"], "narrative": "描述", "sort_order": 0},
    {"id": "route-compact", "day": "1日游", "title": "路线名", "stops": ["id1","id3"], "narrative": "描述", "sort_order": 1},
    {"id": "route-theme", "day": "主题", "title": "路线名", "stops": ["id2","id4"], "narrative": "描述", "sort_order": 2}
  ]
}`;

    const routeResult = await callDeepSeek([
      { role: 'system', content: '你是一个专业的旅游路线规划师。只返回JSON。' },
      { role: 'user', content: routePrompt },
    ]);

    const routes = (routeResult.routes || []).map((r, i) => ({
      id: r.id,
      day: r.day || '',
      title: r.title,
      stops: r.stops || [],
      narrative: r.narrative || '',
      sort_order: i,
    }));

    // ── 6. Write to Supabase ──
    console.log(`Writing ${locations.length} locations + ${routes.length} routes to Supabase...`);

    // Delete old data
    await fetch(`${SUPABASE_URL}/rest/v1/locations?tour_id=eq.${tourId}`, {
      method: 'DELETE', headers: headers,
    });
    await fetch(`${SUPABASE_URL}/rest/v1/routes?tour_id=eq.${tourId}`, {
      method: 'DELETE', headers: headers,
    });

    // Insert locations
    for (const loc of locations) {
      const body = {
        id: loc.id,
        tour_id: tourId,
        name: loc.name,
        lat: loc.lat,
        lng: loc.lng,
        elevation: loc.elevation || '',
        importance: loc.importance || 3,
        tags: loc.tags || [],
        layers: loc.layers || {},
        reflection: loc.reflection || '',
        practical: loc.practical || {},
        sort_order: loc.sort_order || 0,
      };
      await fetch(`${SUPABASE_URL}/rest/v1/locations`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });
    }

    // Insert content_layers
    const layerDefs = tour.destination?.type === 'mountain' || !tour.destination?.type
      ? [
          { layer_key: 'novel', name: '文学意境', icon: '📖', color: '#c0392b', sort_order: 0 },
          { layer_key: 'history', name: '历史掌故', icon: '🏛', color: '#d35400', sort_order: 1 },
          { layer_key: 'folklore', name: '民间传说', icon: '🐉', color: '#27ae60', sort_order: 2 },
          { layer_key: 'customs', name: '地域文化', icon: '🎭', color: '#2980b9', sort_order: 3 },
        ]
      : [
          { layer_key: 'novel', name: '历史现场', icon: '🏛', color: '#c0392b', sort_order: 0 },
          { layer_key: 'history', name: '帝王足迹', icon: '👑', color: '#d35400', sort_order: 1 },
          { layer_key: 'folklore', name: '民间传说', icon: '🐉', color: '#27ae60', sort_order: 2 },
          { layer_key: 'customs', name: '考古发现', icon: '⛏', color: '#2980b9', sort_order: 3 },
        ];

    await fetch(`${SUPABASE_URL}/rest/v1/content_layers?tour_id=eq.${tourId}`, {
      method: 'DELETE', headers: headers,
    });

    for (const layer of layerDefs) {
      await fetch(`${SUPABASE_URL}/rest/v1/content_layers`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ ...layer, tour_id: tourId }),
      });
    }

    // Insert routes
    for (const route of routes) {
      const body = {
        id: route.id,
        tour_id: tourId,
        day_label: route.day || '',
        title: route.title,
        stops: route.stops || [],
        narrative: route.narrative || '',
        sort_order: route.sort_order || 0,
      };
      await fetch(`${SUPABASE_URL}/rest/v1/routes`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
      });
    }

    console.log('Done!');
    return res.status(200).json({
      success: true,
      locations: locations.length,
      routes: routes.length,
    });
  } catch (error) {
    console.error('Process tour error:', error);
    return res.status(500).json({ error: error.message });
  }
}
