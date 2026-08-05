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
  // 名称重叠过滤：高德文本搜索 top 常是同景区相关点（搜"袁家界"→"杨家界乘车处"、"十里画廊"→"索溪峪"），
  // 必须要求 POI 名称真正包含目标名，否则会把袁家界放到杨家界坐标。
  const overlaps = (pois: any[]) => pois.filter((p: any) => p.name?.includes(name) || name.includes(p.name || ""));
  // 名称匹配点中优先"风景名胜|旅游景点"类型（如"袁家界游客基地"是生活服务，应让位"袁家界景区-观景台"）
  const preferScenic = (pois: any[]) => {
    const s = pois.filter((p: any) => /风景名胜|旅游景点|名胜|景区|公园/.test(p.type || ""));
    return s.length ? s : pois;
  };
  const query = async (types: string | null) => {
    const typesParam = types ? `&types=${encodeURIComponent(types)}` : "";
    // 高德限流(CUQPS_HAS_EXCEEDED_THE_LIMIT)在连续查询时高频出现 → 延迟 300ms 重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}&city=${cityParam}&key=${GAODE_KEY}${typesParam}&citylimit=true`, { signal: AbortSignal.timeout(30000) });
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise(r2 => setTimeout(r2, 300)); continue; }
      return (d.pois || []).filter((p: any) => !/省.*市/.test(p.name || ""));
    }
    return [];
  };
  // 严格搜索：按 风景名胜|旅游景点 类型
  let matched = overlaps(await query("风景名胜|旅游景点"));
  // 放宽兜底：严格类型无名称匹配（含返回一堆无关点但无匹配，如袁家界）→ 无 types 全类型重查
  if (!matched.length) {
    matched = overlaps(await query(null));
  }
  if (!matched.length) return null;
  const top = preferScenic(matched)[0];
  const [lng, lat] = top.location.split(",").map(Number);
  // 名称清洗：剥"武陵源风景名胜区-"等前缀 + "游客基地/上站/售票处/小火车/观景台/景区"等后缀
  // 多轮清洗直至稳定：袁家界景区-观景台 → 袁家界景区 → 袁家界
  let clean = top.name.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = clean.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === clean) break;
    clean = next;
  }
  return { lng, lat, name: clean || top.name };
}

// 查询目的地区域（城市）的知名风景/旅游景点，用于自动补地区景点 → 组主题游。
// 确定性来源，不依赖 AI 判断；配合离群去重，只保留与核心距离 >5km 的独立景点。
async function gaodeRegionScenics(city: string): Promise<{ lng: number; lat: number; name: string }[]> {
  const cityParam = encodeURIComponent((splitRegion(city).city || city).replace(/[市]$/g, ""));
  const r = await fetch(`https://restapi.amap.com/v3/place/text?city=${cityParam}&key=${GAODE_KEY}&types=风景名胜|旅游景点&citylimit=true&offset=30`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || ""))
    .map((p: any) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: p.name }; });
}

// 以风景区/名胜区为锚点，查其内部子景点（如武陵源内的百龙天梯/金鞭溪/十里画廊等）
async function gaodeAroundScenics(lng: number, lat: number): Promise<{ lng: number; lat: number; name: string }[]> {
  const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=30000&offset=100`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  // 去掉 types 过滤后杂点多：清洗名称（剥掉"售票处/上站/游客中心/社区"等后缀，露出景点本名，
  // 如"百龙天梯上站"→"百龙天梯"、"十里画廊观光电车售票处"→"十里画廊"、"袁家界游客基地"→"袁家界"），
  // 并过滤明显非景点（餐饮/咖啡/酒店/商场等）。
  const JUNK = /咖啡|餐厅|奶茶|小吃|甜品|麦当劳|瑞幸|宾馆|酒店|超市|银行|加油站|KTV|健身房/;
  // 正向过滤：仅保留名称含景点特征的 POI（去掉无 types 查询混入的餐馆/商店/驿站等）
  const ATTRACTION = /景|峰|峡|桥|梯|画廊|溪|界|寨|洞|寺|观|湖|湾|山|岭|谷|岩|石|门|瀑|泉|亭|阁|殿|庙|祠|塔|墓|园|池|林|松|海|台|田|索道|温泉|漂流|故居|书院/;
  const strip = (n: string) => n
    .replace(/^.*风景名胜区-|^.*国家森林公园-?/, "")
    .replace(/观光电车|世界第一梯/, "")
    .replace(/售票处|上站|下站|游客中心|游客基地|社区|集邮点|入口|出口$/, "")
    .trim();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || "") && !JUNK.test(p.name || "") && ATTRACTION.test(p.name || ""))
    .map((p: any) => { const [lng2, lat2] = p.location.split(",").map(Number); return { lng: lng2, lat: lat2, name: strip(p.name) || p.name }; });
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
    const r = await fetch(`https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${GAODE_KEY}`, { signal: AbortSignal.timeout(30000) });
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
    const r = await fetch("https://api.deepseek.com/v1/chat/completions", { signal: AbortSignal.timeout(120000), // 防止挂死
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
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 6000)}\n\n提取目的地自身值得探访的地点：有文本时以文本提到的地点为准；文本为空时列出目的地自身及紧邻的真实名胜（山峰、宫观、栈道、园区、古迹等）。至少提取 8-12 个（景点多可更多）。宁可多列，坐标校验会过滤掉不存在的——不要遗漏真实景点。\nJSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
    ]);

    const warnings: string[] = [];
    let hasRegionTour = false; // 仅由下述确定性高德地区合并判定（AI 不稳定，不做依据）
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
        const regionScenics = await gaodeRegionScenics(destRegion); // 市级知名景点（types过滤，干净）
        // 网络搜索式：用 AI 知识列出地区著名景点/知名景区著名子景点，再逐个用高德校验坐标。
        // 比在高德杂音里过滤更可靠——AI 知道袁家界/金鞭溪/十里画廊/百龙天梯等名胜名，高德负责确认真实坐标。
        let aiAttractions: string[] = [];
        try {
          const rr2 = await deepseek([
            { role: "system", content: "你是中国旅游专家。只返回JSON。" },
            { role: "user", content: `目的地：${destName}（${destRegion}）。列出该地区除\"${destName}\"自身外、最值得一游的著名独立景点，以及 ${destName} 所在知名景区的著名子景点。只列真实存在、广为人知的著名景点（示例：若在张家界武陵源，则含天子山、黄石寨、杨家界、袁家界、金鞭溪、十里画廊、百龙天梯、水绕四门、宝峰湖、黄龙洞、张家界大峡谷）。8-15 个。JSON: {\"attractions\":[\"名称1\",\"名称2\"]}` },
          ]);
          aiAttractions = (rr2.attractions || []).map(String).filter(Boolean);
        } catch (e) { /* AI 提议失败不阻断 */ }
        const nameSeen = new Set<string>();
        const regionFinal: { lng: number; lat: number; name: string }[] = [];
        for (const p of regionScenics) {
          if (regionFinal.some(q => haversineM(q, p) < 1000)) continue; // 同坐标（如武陵源/张家界国家森林公园）只留一个
          if (!nameSeen.has(p.name)) { nameSeen.add(p.name); regionFinal.push(p); }
        }
        for (const name of aiAttractions) {
          if (nameSeen.has(name)) continue;
          const c = await gaode(name, destRegion);
          if (!c || !c.lat) continue;
          if (locs.some(l => haversineM(l, c) < 5000)) continue; // 距核心太近 → 非独立地区点
          const n = c.name || name;
          if (nameSeen.has(n)) continue;
          nameSeen.add(n);
          regionFinal.push({ lng: c.lng, lat: c.lat, name: n });
        }
        if (regionFinal.length >= 3) {
          const addN = Math.min(20, regionFinal.length); // 最多并入20个地区景点（用户上限，不超20）
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
      ...(locs.length >= 8 ? [{ label: "2日全景游", desc: "目的地核心（第1天）+ 主景区（第2天，如武陵源）完整两天行程；第2天应含主景区全部著名子景点（可达 6-8 站）" }] : []),
      ...(hasRegionTour ? [{ label: "主题游", desc: "完整地区行程：目的地核心景点 + 地区其他知名景点（如天门山+武陵源+黄龙洞+大峡谷），narrative 可写 3 天" }] : []),
      ...(isNovelBased ? [{ label: "文学巡礼线", desc: `跟随小说《${novelName}》的情节场景顺序游览相关地点` }] : []),
    ];
    const routeReqText = routeReqs.map((r, i) => `${i + 1}. ${r.label} — ${r.desc}`).join("\n");
    let routes: any[] = [];
    for (let attempt = 0; attempt < 2 && routes.length < routeReqs.length; attempt++) {
      const rr = await deepseek([
        { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
        { role: "user", content: `${destName}路线。可选地点（id: 名称）: ${locs.map(l => `${l.id}: ${l.name}`).join(", ")}\n\n按序严格生成 ${routeReqs.length} 条路线：\n${routeReqText}\n\n要求：\n1. 每条路线覆盖其主题对应的地点，形成完整行程（从某入口/索道进 → 逐点游览 → 出口/索道出）。\n2. narrative 各写 150-300 字完整行程描述：从哪个入口/索道进、每段用什么交通（徒步/索道/观光车）、依次经过哪些地点、从哪里出。narrative 中必须写地点的中文名（如"玉京峰"），严禁写 id 代号。\n3. **路线覆盖以"景区/大区域"为容量单位，每个主要景区（如天门山、武陵源、黄龙洞、大峡谷）各需约一整天**：按地点名称归组到所属景区。1日精华游只含目的地核心景区（≤6 站）；2日全景游 = 第1天核心景区（如天门山）+ 第2天主景区（如武陵源），**第2天应尽量覆盖主景区的全部著名子景点（天子山、黄石寨、杨家界、袁家界、金鞭溪、十里画廊、百龙天梯、水绕四门等，可达 6-8 站）**，每天 ≤8 站、总 ≤14，narrative 明确第1天/第2天各去哪；主题游含全部景区（narrative 按景区数安排天数）。**严禁把 3 个以上景区塞进 2 日游**；**若某景区距核心景区 >40km（如张家界大峡谷、黄龙洞与天门山相距甚远），不得放入 1日/2日游，只能放入主题游**。\n4. **主题游必须包含目的地核心景点**；1日精华/2日全景/主题游覆盖范围逐步扩大且互补（精华⊂全景⊂主题游）。\n5. 地点少时压缩天数，严禁编造不存在的多日行程。\n6. stops 数组顺序必须与 narrative 中的实际游览顺序一致（入口/索道在前，依次游览，出口/索道在后）；stops 只能从上面给出的 id 中逐字复制，严禁自创或使用列表外的 id。\n7. 路线条数必须与上述完全一致（${routeReqs.length} 条），缺一不可。\nJSON: {"routes":[{"day_label":"","title":"","stops":["id1","id2"],"narrative":"完整行程描述"}]}` },
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
          stops: resolved, // 信任 AI 的游览顺序（入口/索道在前），不按地理重排
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
