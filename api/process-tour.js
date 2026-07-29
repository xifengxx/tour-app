/**
 * Vercel Serverless Function — AI 自动处理导览
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const GAODE_KEY = '2ff1bf71b26aed0a92eb4ab63657bb25';

export default {
  async fetch(request) {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    const { tourId } = body;
    if (!tourId) return Response.json({ error: 'Missing tourId' }, { status: 400 });

    // Use user's JWT for RLS, or fall back to anon key
    const auth = request.headers.get('authorization') || '';
    const userToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const h = (t) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t || SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' });
    const headers = h(userToken);

    try {
      // 1. Fetch draft
      const tours = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`, { headers }).then(r => r.json());
      const tour = Array.isArray(tours) ? tours[0] : tours;
      if (!tour) return Response.json({ error: 'Tour not found' }, { status: 404 });

      const destName = tour.destination?.name || '';
      const destRegion = tour.destination?.region || '';
      const sourceText = tour.source?.rawText || '';
      console.log(`Processing: ${tour.title}, ${sourceText.length} chars`);

      // 2. Extract locations via DeepSeek
      const locData = await deepseek([
        { role: 'system', content: '你是中国旅游规划专家。只返回JSON。' },
        { role: 'user', content: `目的地：${destName}（${destRegion}）\n文本：${sourceText.slice(0, 6000)}\n\n提取所有值得探访的地点。返回JSON：{"locations":[{"id":"py-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
      ]);

      const locations = [];
      for (const l of (locData.locations || [])) {
        const coord = await gaodeCoord(l.name, destRegion);
        locations.push({ id: l.id, name: l.name, lat: coord?.lat || 0, lng: coord?.lng || 0, elevation: l.elevation || '', importance: l.importance || 3, tags: l.tags || [], sort_order: locations.length });
      }
      console.log(`${locations.length} locations`);

      // 3. Generate content
      const contentData = await deepseek([
        { role: 'system', content: '你是文学旅游内容创作者。只返回JSON。' },
        { role: 'user', content: `为以下地点生成四层内容（文学意境📖/历史掌故🏛/民间传说🐉/地域文化🎭）。\n${locations.map(l => `- ${l.id}: ${l.name}`).join('\n')}\n参考：${sourceText.slice(0, 4000)}\n\n每层150-250字。加reflection和practical。返回JSON：{"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
      ]);
      for (const l of locations) {
        const cd = (contentData.locations || []).find(c => c.id === l.id) || {};
        l.layers = cd.layers || {}; l.reflection = cd.reflection || ''; l.practical = cd.practical || {};
      }

      // 4. Plan routes
      const routeData = await deepseek([
        { role: 'system', content: '你是旅游路线规划师。只返回JSON。' },
        { role: 'user', content: `规划${destName}游览路线。地点：${locations.map(l => `${l.id}:${l.name}`).join(',')}\n\n3条路线（2日/1日/主题）。返回JSON：{"routes":[{"id":"r1","day_label":"2日游","title":"","stops":[],"narrative":"","sort_order":0}]}` },
      ]);
      const routes = (routeData.routes || []).map((r, i) => ({ id: r.id, day_label: r.day_label || '', title: r.title, stops: r.stops || [], narrative: r.narrative || '', sort_order: i }));

      // 5. Write to Supabase
      console.log(`Writing ${locations.length} locs + ${routes.length} routes`);
      await fetch(`${SUPABASE_URL}/rest/v1/locations?tour_id=eq.${tourId}`, { method: 'DELETE', headers });
      await fetch(`${SUPABASE_URL}/rest/v1/routes?tour_id=eq.${tourId}`, { method: 'DELETE', headers });
      for (const l of locations) {
        await fetch(`${SUPABASE_URL}/rest/v1/locations`, { method: 'POST', headers, body: JSON.stringify({ id: l.id, tour_id: tourId, name: l.name, lat: l.lat, lng: l.lng, elevation: l.elevation, importance: l.importance, tags: l.tags, layers: l.layers, reflection: l.reflection, practical: l.practical, sort_order: l.sort_order }) });
      }
      await fetch(`${SUPABASE_URL}/rest/v1/content_layers?tour_id=eq.${tourId}`, { method: 'DELETE', headers });
      const layers = [
        { layer_key: 'novel', name: '文学意境', icon: '📖', color: '#c0392b', sort_order: 0 },
        { layer_key: 'history', name: '历史掌故', icon: '🏛', color: '#d35400', sort_order: 1 },
        { layer_key: 'folklore', name: '民间传说', icon: '🐉', color: '#27ae60', sort_order: 2 },
        { layer_key: 'customs', name: '地域文化', icon: '🎭', color: '#2980b9', sort_order: 3 },
      ];
      for (const ly of layers) { await fetch(`${SUPABASE_URL}/rest/v1/content_layers`, { method: 'POST', headers, body: JSON.stringify({ ...ly, tour_id: tourId }) }); }
      for (const r of routes) { await fetch(`${SUPABASE_URL}/rest/v1/routes`, { method: 'POST', headers, body: JSON.stringify({ id: r.id, tour_id: tourId, day_label: r.day_label, title: r.title, stops: r.stops, narrative: r.narrative, sort_order: r.sort_order }) }); }

      console.log('Done!');
      return Response.json({ success: true, locations: locations.length, routes: routes.length });
    } catch (e) {
      console.error(e);
      return Response.json({ error: e.message }, { status: 500 });
    }
  },
};

async function gaodeCoord(name, city) {
  const kw = encodeURIComponent(`${city || ''} ${name}`);
  const res = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&key=${GAODE_KEY}&types=风景名胜|旅游景点`);
  const d = await res.json();
  if (d.pois?.length) { const [lng, lat] = d.pois[0].location.split(',').map(Number); return { lng, lat }; }
  return null;
}

async function deepseek(messages) {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 8192, response_format: { type: 'json_object' } }),
  });
  if (!res.ok) throw new Error(`DeepSeek: ${res.status}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}
