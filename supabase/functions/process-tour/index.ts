// Supabase Edge Function: AI 自动处理导览
// 部署: npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt
// Secrets: supabase secrets set DEEPSEEK_API_KEY=sk-... GAODE_KEY=2ff1... --project-ref qxunedraoviaonjdanag

// 高德 Key 必须走环境变量（supabase secrets set GAODE_KEY=...），禁止硬编码
const GAODE_KEY = Deno.env.get("GAODE_KEY") || "";
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
    headers: { ...hdr, Prefer: "return=representation,resolution=ignore-duplicates" },
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

async function gaode(name: string, destCity: string) {
  const kw = encodeURIComponent(name);
  // 高德 city 参数只接受城市名/adcode，不能是"省+市"。
  // "安徽省黄山市" → "黄山"；否则 citylimit=true 被静默忽略，全国同名点乱入。
  const cityParam = encodeURIComponent((splitRegion(destCity).city || destCity).replace(/[市]$/g, ""));
  // 不做 location 偏置：目的地地理编码可能偏到行政中心（如"三清山"被编码到上饶市区，距真景点 50km），
  // 偏置反而排挤真景点。靠城市限定 + 类型过滤 + 后续聚类离群点剔除保证质量。
  const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&city=${cityParam}&key=${GAODE_KEY}&types=风景名胜|旅游景点&citylimit=true`);
  const d = await r.json();
  // 过滤地址式 POI：名称形如"湖北省武汉市洪山区象鼻山"（整串地址当名称）的多为非景点的幻觉点。
  // 真实景点名称是短的（"黄鹤楼""晴川阁"），不会带"省…市"。
  const realPois = (d.pois || []).filter((p: any) => !/省.*市/.test(p.name || ""));
  if (realPois.length) { const [lng, lat] = realPois[0].location.split(",").map(Number); return { lng, lat, name: realPois[0].name }; }
  return null;
}

// 查询目的地区域（城市）的知名风景/旅游景点，用于自动补地区景点 → 组主题游。
// 确定性来源，不依赖 AI 判断；配合离群去重，只保留与核心距离 >5km 的独立景点。
async function gaodeRegionScenics(city: string): Promise<{ lng: number; lat: number; name: string }[]> {
  const cityParam = encodeURIComponent((splitRegion(city).city || city).replace(/[市]$/g, ""));
  const r = await fetch(`https://restapi.amap.com/v3/place/text?city=${cityParam}&key=${GAODE_KEY}&types=风景名胜|旅游景点&citylimit=true&offset=30`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || ""))
    .map((p: any) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: p.name }; });
}

// 离群点剔除：真实地点聚成簇，编造/过远点是离群点。
// 以候选点中位数为中心，迭代剔除 >20km 的点（最多 3 轮）。
// 不依赖地理编码中心 —— 某些目的地（三清山）地理编码会偏到行政中心，固定中心校验会误杀真景点。
function pruneFarPoints(cands: { lng: number; lat: number }[]): { lng: number; lat: number }[] {
  if (cands.length <= 2) return cands;
  const med = (arr: number[]) => {
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  let pts = cands;
  for (let round = 0; round < 3; round++) {
    const c = { lng: med(pts.map(p => p.lng)), lat: med(pts.map(p => p.lat)) };
    const next = pts.filter(p => haversineM(c, p) <= 20000);
    if (next.length < 2 || next.length === pts.length) break;
    pts = next;
  }
  return pts;
}

// Regeo: verify a coordinate is actually in the expected city/province.
// 返回值三态：object=坐标可解析；undefined=API 不可达；null=坐标无法解析。
async function regeo(lng: number, lat: number) {
  try {
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${GAODE_KEY}`);
    if (!r.ok) return undefined;
    const d = await r.json();
    if (d.status === "1" && d.regeocode?.addressComponent) {
      const ac = d.regeocode.addressComponent;
      return { province: ac.province, city: ac.city, district: ac.district, adcode: ac.adcode };
    }
    return null;
  } catch {
    // API failure — skip validation, don't crash
    return undefined;
  }
}

// ── Region helpers ─────────────────────────────────────────────
// "安徽省黄山市" → {prov:"安徽省", city:"黄山市"}; "黄山市" → {prov:"", city:"黄山市"}
function splitRegion(t: string) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  return { prov: "", city: t };
}
const stripSuffix = (s: any) => String(s).replace(/[市]$/g, "");

// Check if a location is plausibly in the expected region.
// 支持各种输入格式："安徽省黄山市"、"黄山市"、"黄山"、"北京"（直辖市）、"江西"（裸省名）、"江西省"。
// 规则：
//   1) 目标明确含"市"（省+市 或 裸市名）→ 城市必须匹配（直辖市用 province 兜底），省份不够。
//   2) 目标只含"省/自治区"（如"江西省""内蒙古自治区"）→ 省份匹配即可。
//   3) 目标是无后缀裸名（"江西""黄山"）→ 省或市任一匹配即可。
// 注意：高德 regeo 对直辖市返回 city=[]（空数组，truthy），须显式回退到 province。
function regionMatch(geo: { province: string; city: string | string[] }, targetRegion: string): boolean {
  if (!geo) return false;
  const norm = String(targetRegion).trim();
  if (!norm) return false;
  const gProv = String(geo.province || "");
  const gCity = Array.isArray(geo.city) ? (geo.city[0] || "") : String(geo.city || "");
  const gCityCand = gCity || gProv; // 直辖市：city 为空 → 用 province 兜底

  const sheng = norm.indexOf("省");
  const zzq = norm.indexOf("自治区");
  let provPart = "", cityPart = "";
  if (sheng > -1) { provPart = norm.slice(0, sheng); cityPart = norm.slice(sheng + 1); }
  else if (zzq > -1) { provPart = norm.slice(0, zzq); cityPart = norm.slice(zzq + 3); }

  if (cityPart) {
    // 明确指定了市 → 市必须匹配
    const tCityCands = [cityPart, stripSuffix(cityPart)];
    return tCityCands.some(tc => tc && (gCityCand.includes(tc) || tc.includes(stripSuffix(gCityCand))));
  }
  if (provPart) {
    // 只指定了省
    const tProvCands = [provPart, stripSuffix(provPart)];
    return tProvCands.some(tp => tp && gProv.includes(tp));
  }
  // 裸名（"江西""黄山""北京"）→ 省或市任一匹配
  const cands = [norm, stripSuffix(norm)];
  return cands.some(k => k && (gProv.includes(k) || gCityCand.includes(k)));
}

// 坐标距离（米）— 用于地点去重（DeepSeek 常提取多个近义地名到同一 POI）
const EARTH_R = 6371000;
const DEDUP_M = 150;
function haversineM(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(s));
}

async function deepseek(messages: { role: string; content: string }[], retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` },
      body: JSON.stringify({ model: "deepseek-chat", messages, temperature: 0.7, max_tokens: 8192, response_format: { type: "json_object" } }),
    });
    if (!r.ok) throw new Error(`DeepSeek: ${r.status}`);
    const text = ((await r.json()).choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("DeepSeek 返回空内容");
    // 剥离 ```json ... ``` 代码块后解析，避免模型偶尔包裹 markdown
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      // 模型偶发返回截断/畸形 JSON → 重试（非确定性，重试常能成功）
      if (attempt < retries) continue;
      throw new Error(`DeepSeek JSON 解析失败: ${(e as Error).message}`);
    }
  }
  throw new Error("DeepSeek 调用失败");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let tourId: string | undefined;
  try {
    ({ tourId } = await req.json());
    if (!tourId) return json({ error: "Missing tourId" }, 400);
    if (!GAODE_KEY) return json({ error: "GAODE_KEY 未配置（supabase secrets set GAODE_KEY=...）" }, 500);

    // 1. Fetch draft (use REST directly since service_role bypasses RLS)
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`, { headers: hdr }).then(r => r.json());
    const tour = Array.isArray(rows) ? rows[0] : rows;
    if (!tour) return json({ error: "Tour not found" }, 404);
    // 注意：此处不能再 setStatus("processing") —— 导览已由 INSERT/UPDATE 触发器置为 processing，
    // 再设一次会触发 UPDATE 触发器 → 函数被并发调用两次（双重写导致数据错乱）。

    const destName = tour.destination?.name || "";
    const destRegion = tour.destination?.region || "";
    const src = tour.source?.rawText || "";
    console.log(`Processing: ${tour.title}, ${src.length} chars`);

    // 2. Extract locations
    const lr = await deepseek([
      { role: "system", content: "你是中国旅游规划专家。只返回JSON。只提取真实存在的地点，不确定的地点不要提取。只列固定旅游景点/地标/古迹/公园/山峰/宫观，不要临时展览、活动、演出、商业店铺等非固定地点。" },
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 6000)}\n\n提取值得探访的地点，分两部分：\n【第一部分·目的地核心】先完整提取目的地自身的景点（如天门山：天门山索道、天门洞、鬼谷栈道、天门山寺、云梦仙顶、通天大道等），这是本次旅行的主角，必须覆盖。有文本时以文本提到的地点为准。\n【第二部分·地区景点】若目的地所在城市/地区是知名的多景点旅游区（如天门山在张家界市，武陵源、天子山、杨家界、金鞭溪、黄龙洞、宝峰湖等也是张家界必游），则把这些地区知名景点也提取进来——它们是同一趟旅行的目的地（如东湖在武汉市，也要提黄鹤楼、晴川阁）。若地区没有可并联的其他知名景点（如庐山、黄山，景点都在同一山内），则只提取目的地核心。\n涵盖主要景点和次一级地标（山峰、宫观、栈道、园区、古迹、名楼等）。至少提取 8-12 个（景点多的目的地可更多）。宁可多列，坐标校验会过滤掉不存在的——不要遗漏真实景点。\n\n同时判断 hasRegionTour：目的地所在城市/地区有多个知名独立景点可组主题游（张家界市、武汉市 → true）→ true；景点都集中在同一景点/山脉内（庐山、黄山 → false）→ false。若 true，则 locations 必须同时含目的地核心与地区知名景点。\nJSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}],"hasRegionTour":true}` },
    ]);

    const warnings: string[] = [];
    let hasRegionTour = !!lr.hasRegionTour; // AI 判定；下述高德地区查询可确定性补正
    const locs: any[] = [];
    for (const l of (lr.locations || [])) {
      const c = await gaode(l.name, destRegion);
      if (!c || !c.lat) {
        warnings.push(`⚠️ "${l.name}" 未找到坐标，已跳过`);
        continue;
      }
      // Verify coordinate is in the target region
      const geo = await regeo(c.lng, c.lat);
      if (geo === undefined) {
        warnings.push(`⚠️ "${l.name}" 坐标校验失败（高德 API 不可达），已跳过`);
        continue;
      }
      if (geo === null) {
        warnings.push(`⚠️ "${l.name}" 坐标(${c.lng},${c.lat})无法解析，已跳过`);
        continue;
      }
      if (!regionMatch(geo, destRegion)) {
        warnings.push(`⚠️ "${l.name}" 坐标(${c.lng},${c.lat})位于 ${geo.province}${geo.city || ''}，不在 ${destRegion}，已跳过`);
        continue;
      }
      // Use Gaode's official name if available
      const displayName = c.name && c.name !== l.name ? c.name : l.name;
      locs.push({ id: l.id, name: displayName, lat: c.lat, lng: c.lng, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [], sort_order: locs.length });
    }

    // 聚类离群点剔除：真实地点聚成簇，编造/过远点（江夏龟山 45km、罗汉寺街皇庙 43km）是离群点。
    // 不依赖地理编码中心 —— 三清山等目的地的中心会偏到行政中心，固定中心校验会误杀全部真景点。
    const clusterKeep = new Set(pruneFarPoints(locs));
    if (clusterKeep.size < locs.length) {
      for (const l of locs) {
        if (!clusterKeep.has(l)) warnings.push(`⚠️ "${l.name}" 距其他地点过远（离群点），已剔除`);
      }
      locs.length = 0;
      locs.push(...clusterKeep);
    }

    const extractedBeforeDedup = locs.length;

    // 坐标去重：距离 <150m 视为同一地点，保留 importance 更高者（地图上避免标记重叠）
    const deduped: any[] = [];
    for (const l of locs) {
      const dup = deduped.find(d => haversineM(d, l) < DEDUP_M);
      if (dup) {
        if ((l.importance || 3) > (dup.importance || 3)) {
          deduped[deduped.indexOf(dup)] = l;
          warnings.push(`♻️ "${dup.name}" 与 "${l.name}" 距离过近(<${DEDUP_M}m)，保留重要性更高者`);
        } else {
          warnings.push(`♻️ "${l.name}" 与 "${dup.name}" 距离过近(<${DEDUP_M}m)，已去重`);
        }
        continue;
      }
      deduped.push(l);
    }
    deduped.forEach((l, i) => (l.sort_order = i));
    locs.length = 0;
    locs.push(...deduped);
    console.log(`${locs.length} locations (${warnings.length} warnings)`);

    // 地区景点补充（确定性）：查询目的地区域知名景点，与核心所有点相距 >5km 的独立景点 ≥3 个
    // → 并入并触发主题游（不依赖 AI 随机判断；如张家界市并入国家森林公园/黄龙洞等）
    if (destRegion && locs.length >= 3) {
      try {
        const regionScenics = await gaodeRegionScenics(destRegion);
        const distinct = regionScenics.filter(p => locs.every(l => haversineM(l, p) > 5000)); // 与核心全部 >5km
        const dedupedRegion = distinct.filter((p, i) => !distinct.slice(0, i).some(q => haversineM(q, p) < 5000)); // 地区点间互去重
        // 包含关系过滤：两个"风景区/名胜区"类 POI 相距 <8km 时保留名称更长者（如武陵源 ⊃ 天子山，天子山不单列）
        const umbrellaSuffix = /(风景区|名胜区|景区|森林公园)$/;
        const regionFinal = dedupedRegion.filter(p =>
          !dedupedRegion.some(q => q !== p && haversineM(q, p) < 8000 && umbrellaSuffix.test(q.name) && umbrellaSuffix.test(p.name) && q.name.length > p.name.length)
        );
        if (regionFinal.length >= 3) {
          const addN = Math.min(4, regionFinal.length);
          for (const p of regionFinal.slice(0, addN)) {
            locs.push({ id: `reg-${locs.length}`, name: p.name, lat: p.lat, lng: p.lng, elevation: "", importance: 4, tags: ["地区景点"], layers: {}, reflection: "", practical: {} });
          }
          locs.forEach((l, i) => (l.sort_order = i));
          hasRegionTour = true;
          warnings.push(`🌏 自动并入 ${addN} 个地区知名景点（可组主题游）`);
        }
      } catch (e) { /* 区域查询失败不阻断 */ }
    }

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

    // Build coordinate lookup for proximity-based reordering
    const locCoords = new Map(locs.map(l => [l.id, { lng: l.lng, lat: l.lat, name: l.name }]));
    const dist = (a: {lng:number,lat:number}, b: {lng:number,lat:number}) => Math.sqrt((a.lng-b.lng)**2 + (a.lat-b.lat)**2);

    // Reorder stops by nearest-neighbor starting from the most extreme point,
    // so the route follows a consistent geographic path.
    const reorderByProximity = (stops: string[]): string[] => {
      if (stops.length <= 2) return stops;
      // Find the two most distant points — start from one of them
      let maxDist = 0, start = stops[0];
      for (const a of stops) {
        for (const b of stops) {
          const ca = locCoords.get(a), cb = locCoords.get(b);
          if (ca && cb) { const d = dist(ca, cb); if (d > maxDist) { maxDist = d; start = a; } }
        }
      }
      const remaining = new Set(stops);
      const ordered: string[] = [];
      let current = start;
      while (remaining.size > 0) {
        ordered.push(current);
        remaining.delete(current);
        let best: string | null = null;
        let bestDist = Infinity;
        const curCoord = locCoords.get(current);
        if (curCoord) {
          for (const s of remaining) {
            const c = locCoords.get(s);
            if (c) { const d = dist(curCoord, c); if (d < bestDist) { bestDist = d; best = s; } }
          }
        }
        current = best || [...remaining][0] || current;
      }
      return ordered;
    };

    // 4. Routes — 新结构：1日精华游(必有) + 2日全景游(地点≥8) + 主题游(地区多景点) + 文学巡礼线(小说源)
    const isNovelBased = !!(tour.source?.title || tour.source?.novelTitle);
    const novelName = String(tour.source?.title || tour.source?.novelTitle || '');
    const routeReqs = [
      { label: "1日精华游", desc: "目的地核心必看景点，1天内完成（≤6 站）" },
      ...(locs.length >= 8 ? [{ label: "2日全景游", desc: "目的地核心 + 邻近主景区的完整两天行程（分两天，每天 ≤6 站）" }] : []),
      ...(hasRegionTour ? [{ label: "主题游", desc: "完整地区行程：目的地核心景点 + 地区其他知名景点（如天门山+武陵源+黄龙洞+大峡谷），narrative 可写 3 天" }] : []),
      ...(isNovelBased ? [{ label: "文学巡礼线", desc: `跟随小说《${novelName}》的情节场景顺序游览相关地点` }] : []),
    ];
    const routeReqText = routeReqs.map((r, i) => `${i + 1}. ${r.label} — ${r.desc}`).join("\n");
    let routes: any[] = [];
    for (let attempt = 0; attempt < 2 && routes.length < routeReqs.length; attempt++) {
      const rr = await deepseek([
        { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
        { role: "user", content: `${destName}路线。可选地点（id: 名称）: ${locs.map(l => `${l.id}: ${l.name}`).join(", ")}\n\n按序严格生成 ${routeReqs.length} 条路线：\n${routeReqText}\n\n要求：\n1. 每条路线覆盖其主题对应的地点，形成完整行程（从某入口/索道进 → 逐点游览 → 出口/索道出）。\n2. narrative 各写 150-300 字完整行程描述：从哪个入口/索道进、每段用什么交通（徒步/索道/观光车）、依次经过哪些地点、从哪里出。narrative 中必须写地点的中文名（如"玉京峰"），严禁写 id 代号。\n3. **路线覆盖以"景区/大区域"为容量单位，每个主要景区（如天门山、武陵源、黄龙洞、大峡谷）各需约一整天**：按地点名称归组到所属景区（如\"天门山国家森林公园-鬼谷栈道\"属于天门山景区）。1日精华游只含目的地核心景区（≤6 站）；2日全景游只含 2 个景区（核心景区 + 紧邻主景区，如天门山+武陵源，共 ≤10 站，narrative 明确第1天/第2天各去哪）；主题游含全部景区（narrative 按景区数安排天数）。**严禁把 3 个以上景区塞进 2 日游**。\n4. **主题游必须包含目的地核心景点**；1日精华/2日全景/主题游覆盖范围逐步扩大且互补（精华⊂全景⊂主题游）。\n5. 地点少时压缩天数，严禁编造不存在的多日行程。\n6. stops 只能从上面给出的 id 中逐字复制，必须出现在上面列表中，严禁自创、改动或使用列表外的 id。\n7. 路线条数必须与上述完全一致（${routeReqs.length} 条），缺一不可。\nJSON: {"routes":[{"day_label":"","title":"","stops":["id1","id2"],"narrative":"完整行程描述"}]}` },
      ]);
      // Route stop validation: resolve and report mismatches
      const allRoutes = (rr.routes || []).map((r: any, i: number) => {
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
          stops: reorderByProximity(resolved),
          narrative: typeof r.narrative === "string" ? r.narrative : "",
          sort_order: i,
        };
      }).filter(r => r.stops.length > 0);

      // 去重：stops 集合完全相同才视为重复，保留先出现的（1日精华优先）
      const seenKeys = new Set<string>();
      const dedupedRoutes: any[] = [];
      for (const r of allRoutes) {
        const key = [...r.stops].sort().join("|");
        if (!seenKeys.has(key)) { seenKeys.add(key); dedupedRoutes.push(r); }
      }
      routes = dedupedRoutes;
    }

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
      rejected: (lr.locations || []).length - extractedBeforeDedup, // regeo/坐标校验被拒
      deduped: extractedBeforeDedup - locs.length, // 坐标去重数
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
