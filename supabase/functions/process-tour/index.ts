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
      { role: "system", content: "你是中国旅游规划专家。只返回JSON。只提取真实存在的地点，不确定的地点不要提取。只列固定旅游景点/地标/古迹/公园，不要临时展览、活动、演出、商业店铺等非固定地点。" },
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 6000)}\n\n提取值得探访的地点：有文本时以文本提到的地点为准；文本为空或未提及时，列出该目的地及周边公认的著名景点（地标/景区/古迹）。至少提取 5 个。JSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
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
      { role: "user", content: `${destName}路线。可选地点（id: 名称）: ${locs.map(l => `${l.id}: ${l.name}`).join(", ")}\n\n根据地点数量和地理集中度规划 2-3 条真正不同的路线：地点少且集中时只做半日/一日主题路线，严禁编造需要多天的行程（如地点都在步行范围内就绝不能标"2日游"）。每条路线 3-6 个地点（地点不足则全部用上）。路线之间主题或路径必须明显不同。stops 必须是由上面地点 id 组成的字符串数组，如 ["yujing-feng","sanqing-palace"]，严禁返回对象或使用地点以外的 id。JSON: {"routes":[{"day_label":"1日游","title":"","stops":["id1","id2"],"narrative":""}]}` },
    ]);
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

    // 路线去重：stops 重叠度 >70% 视为同一路线（如"1日游/2日游"内容雷同），只保留第一条
    const routes: any[] = [];
    for (const r of allRoutes) {
      const set = new Set(r.stops);
      const dup = routes.find(u => {
        const us = new Set(u.stops);
        const overlap = [...set].filter(s => us.has(s)).length / Math.max(set.size, us.size);
        return overlap > 0.7;
      });
      if (!dup) routes.push(r);
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
