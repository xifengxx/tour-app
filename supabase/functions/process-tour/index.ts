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

async function gaode(name: string, destCity: string, bias?: { lng: number; lat: number }) {
  const kw = encodeURIComponent(name);
  // 高德 city 参数只接受城市名/adcode，不能是"省+市"。
  // "安徽省黄山市" → "黄山"；否则 citylimit=true 被静默忽略，全国同名点乱入。
  // location 位置偏置：目的地地区是裸省名（如"四川"）时 city 无效 → 全省搜索会把
  // "祖师殿/朝阳洞/老君阁"解析到全省同名错点（广汉/遂宁）。传入目的地坐标可让高德优先返回其周边同名点。
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  // city 只接受真实城市名：裸省名（四川/江西/河南省）时 city 无效且 citylimit=true 会压过 location 偏置
  // （实测 city=四川 + bias=青城山 仍把"朝阳洞"解析到遂宁 105.17）→ 不带 city，靠偏置定位。
  const rawCity = (splitRegion(destCity).city || destCity).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `&city=${encodeURIComponent(rawCity)}&citylimit=true`;
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
      const r = await fetch(`https://restapi.amap.com/v3/place/text?keywords=${kw}${cityPart}&key=${GAODE_KEY}${typesParam}${biasParam}`, { signal: AbortSignal.timeout(30000) });
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
  return { lng, lat, name: cleanName(top.name) };
}

// 查询目的地区域（城市）的知名风景/旅游景点，用于自动补地区景点 → 组主题游。
// 确定性来源，不依赖 AI 判断；配合离群去重，只保留与核心距离 >5km 的独立景点。
async function gaodeRegionScenics(city: string, bias?: { lng: number; lat: number }): Promise<{ lng: number; lat: number; name: string }[]> {
  // 与 gaode() 同规则：裸省名时不带 city（无效且压过 location 偏置）
  const rawCity = (splitRegion(city).city || city).replace(/[市]$/g, "");
  const cityIsProvince = !!rawCity && PROV_EXACT.test(rawCity.replace(/省$/g, ""));
  const cityPart = cityIsProvince ? "" : `city=${encodeURIComponent(rawCity)}&citylimit=true&`;
  const biasParam = bias ? `&location=${bias.lng},${bias.lat}` : "";
  const r = await fetch(`https://restapi.amap.com/v3/place/text?${cityPart}key=${GAODE_KEY}&types=风景名胜|旅游景点&offset=30${biasParam}`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.pois || [])
    .filter((p: any) => p.location && !/省.*市/.test(p.name || ""))
    .map((p: any) => { const [lng, lat] = p.location.split(",").map(Number); return { lng, lat, name: p.name }; });
}

// 名称多轮清洗：剥"武陵源风景名胜区-"前缀 + 后缀，直至稳定（袁家界景区-观景台 → 袁家界景区 → 袁家界）。
// 用于 gaode() 与 gaodeAroundScenics() 的名称解析。
function cleanName(n: string): string {
  let c = n.replace(/^.*风景名胜区-|^.*国家森林公园-?/, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = c.replace(/社区|游客基地|游客中心|观光电车|小火车|乘车处|候车处|售票处|上站|下站|集邮点|入口|-?观景台$|风景区$|景区$/, "").trim();
    if (next === c) break;
    c = next;
  }
  return c || n;
}

// ── 景区锚点 / 子景点确定性补全 ─────────────────────────────
const SUB_AREA_RADIUS = 12000; // 点归入最近锚点的距离阈值
const SCAN_RADIUS = 12000;     // around-scan 半径（30km 会跨区扫到七星山/黄龙洞 → 收紧）
const ANCHOR_CAP = 12;         // 每锚点子景点上限
const SUB_TOTAL_CAP = 10;      // 全局子景点上限（控制内容生成长度）
const SUB_DEDUP_M = 300;       // 子景点坐标去重阈值：1000m 会把真子景点误杀（百龙天梯距张家界森林公园仅 700m、
                               // 袁家界距金鞭溪仅 900m 都被当成同一地点剔除）。300m 只去重真正的同点 POI。
const REGION_RADIUS = 60000;   // 地区合并只收核心周边 60km 内：防目的地地区是裸省名（如"四川"）时
                               // 把九寨沟/四姑娘山/峨眉山/泸沽湖（150-500km）整个省的名胜拉进主题游/2日游
// 设施排除：只杀无歧义非景点节点，勿杀 台/桥/亭/塔/门（迷魂台/天下第一桥/水绕四门是真景点）
const FACILITY_RE = /停车场|售票处|售票点|售票大厅|检票口|检票|乘车处|候车(?:处|亭|室)|索道(?:上站|下站|中站|入口|出口|站)?$|缆车$|观光车(?:站|场|停靠点)|游客中心|游客服务(?:点|中心)?|服务区|服务站|服务中心|管理处|管委会|委员会|居委会|村委会|派出所|加油站|银行|超市|商店|小卖部|商业街|饭店|餐厅|宾馆|酒店|客栈|民宿|山庄|农家乐|厕所|卫生间|洗手间|公厕|入口$|出口$|北门|南门|东门|西门|中门|大门|广场$|车站$|码头$|步道$|栈道$|观景台$|平台$|通道|门店|店\)|店$|综合服务|街道|步行街|(?<!故)居$|邮政|快递|营业厅|窗口|咨询台|工会|党员|人社|村委会/;

// 是否为景区锚点：核心景区名匹配，或名称以景区设计词结尾且非"XX-子点"（排除"天门山国家森林公园-天门洞"）
function isScenicAnchor(loc: any, destName: string): boolean {
  const n = String(loc.name || "");
  if (/-/.test(n)) return false; // "XX景区-子点"（如天门山国家森林公园-天门洞）是子点，不是锚点
  if (destName && (n.includes(destName) || destName.includes(n))) return true;
  if (/(风景名胜区|国家森林公园|风景名胜|自然保护区)$/.test(n)) return true;
  if (/(风景区|景区|公园)$/.test(n) && !/-/.test(n)) return true;
  return false;
}
function cleanScenicName(n: string): string {
  return n.replace(/风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|森林公园|公园/g, "").replace(/[-— ]+$/, "").trim() || n;
}
function scenicWeight(n: string, destName: string): number {
  const coreBonus = destName && (n.includes(destName) || destName.includes(n)) ? 7 : 0; // 核心=7
  if (/风景名胜区$/.test(n)) return 6 + coreBonus;
  if (/国家森林公园$/.test(n)) return 5 + coreBonus;
  if (/风景名胜|自然保护区$/.test(n)) return 4 + coreBonus;
  if (/风景区$/.test(n)) return 3 + coreBonus;
  if (/景区$/.test(n)) return 2 + coreBonus;
  if (/公园$/.test(n)) return 1 + coreBonus;
  return coreBonus;
}
// 构建锚点。合并规则：只有【伞形锚点】（权重最高的非核心 风景名胜区|国家森林公园，如武陵源）吸收
// 12km 内的子区域（天子山/黄石寨/森林公园 → 武陵源的 subPoints）。
// 七星山（距天门山仅 4.5km 但距武陵源 30km）、黄龙洞、天门山（核心）是独立景区，不被吸收。
const UMBRELLA_ABSORB_M = 12000; // 伞形锚点吸收子区域的距离（武陵源子景点都在 ~6km 内）
function buildAnchors(locs: any[], destName: string): any[] {
  const cands = locs.filter(l => isScenicAnchor(l, destName))
    .map(l => ({ ...l, scenicName: cleanScenicName(l.name), weight: scenicWeight(l.name, destName) }));
  cands.sort((a, b) => b.weight - a.weight || b.name.length - a.name.length);
  const isCore = (c: any) => destName && (c.name.includes(destName) || destName.includes(c.name));
  const umbrella = cands.find(c => !isCore(c) && /(风景名胜区|国家森林公园)$/.test(c.name)) || null;
  const anchors: any[] = [];
  const ordered = umbrella ? [umbrella, ...cands.filter(c => c !== umbrella)] : cands;
  for (const c of ordered) {
    if (umbrella && c === umbrella) { anchors.push({ ...c, mergedNames: [], subPoints: [] }); continue; }
    const um = anchors.find(a => umbrella && a.name === umbrella.name);
    if (umbrella && um && c.weight < umbrella.weight && haversineM(umbrella, c) < UMBRELLA_ABSORB_M) {
      um.mergedNames.push(c.scenicName);
      um.subPoints.push({ lng: c.lng, lat: c.lat, name: c.scenicName });
      continue;
    }
    anchors.push({ ...c, mergedNames: [], subPoints: [] });
  }
  anchors.sort((a, b) => b.weight - a.weight); // 保持权重降序：核心（天门山）在前
  return anchors;
}

// 以风景区/名胜区为锚点，查其内部子景点（如武陵源内的百龙天梯/金鞭溪/十里画廊等）。
// 确定性来源：不依赖 AI 提议，高德周边扫描 + 景点名过滤 + 清洗。
// 分页：高德 around offset 单页上限 100、按距离排序，武陵源这类大景区 5km+ 的子景点
// 会被前 100 个挤掉 → 并行拉 3 页（page=1,2,3）覆盖。
async function gaodeAroundScenics(lng: number, lat: number, radius = SCAN_RADIUS): Promise<{ lng: number; lat: number; name: string; raw: string }[]> {
  const JUNK = /咖啡|餐厅|奶茶|小吃|甜品|麦当劳|瑞幸|肯德基|烧仙草|汉堡|客栈|民宿|山庄|农家乐|火锅|三下锅|菜馆|私房菜|家常菜|中餐馆|餐馆|乡厨|烧烤|快餐|美食|门店|服务社|宾馆|酒店|超市|银行|加油站|KTV|健身房|旅行社|蜜雪|面包|饮品|烘焙|酸奶|烤面包|速递|快递/;
  // 正向过滤：仅保留名称含景点特征的 POI（去掉无 types 查询混入的餐馆/商店/驿站等）
  const ATTRACTION = /景|峰|峡|桥|梯|画廊|溪|界|寨|洞|寺|观|湖|湾|山|岭|谷|岩|石|门|瀑|泉|亭|阁|殿|庙|祠|塔|墓|园|池|林|松|海|台|田|索道|温泉|漂流|故居|书院/;
  const fetchPage = async (page: number) => {
    // 高德限流在并行扫描时高频出现，静默返回空会让子景点补全失效 → 退避重试 3 次
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await fetch(`https://restapi.amap.com/v3/place/around?location=${lng},${lat}&key=${GAODE_KEY}&radius=${radius}&offset=100&page=${page}`, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) return [];
      const d = await r.json();
      if (d.info === "CUQPS_HAS_EXCEEDED_THE_LIMIT") { await new Promise(r2 => setTimeout(r2, attempt === 0 ? 300 : 800)); continue; }
      return (d.pois || [])
        .filter((p: any) => p.location && !/省.*市/.test(p.name || "") && !JUNK.test(p.name || "") && ATTRACTION.test(p.name || ""))
        .map((p: any) => { const [lng2, lat2] = p.location.split(",").map(Number); return { lng: lng2, lat: lat2, name: cleanName(p.name), raw: p.name }; });
    }
    return [];
  };
  const [p1, p2, p3] = await Promise.all([fetchPage(1), fetchPage(2), fetchPage(3)]);
  const seen = new Set<string>();
  return [...p1, ...p2, ...p3].filter(c => { const k = `${c.lng},${c.lat}|${c.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// 扫描单锚点的子景点：设施排除 + 排除锚点自身/已在 locs/跨锚点候选 + AI 知名度排序，取前 ANCHOR_CAP。
async function scanAnchorSubs(anchor: any, locs: any[], otherAnchors: any[], aiKnown: Set<string>) {
  const around = await gaodeAroundScenics(anchor.lng, anchor.lat, SCAN_RADIUS);
  const existingNames = new Set(locs.map(l => String(l.name || "")));
  const out: any[] = [];
  for (const c of around) {
    const n = String(c.name || "");
    if (!n) continue;
    if (FACILITY_RE.test(n)) continue;                                          // 设施
    if (n === anchor.name || n === anchor.scenicName) continue;                 // 锚点自身（精确匹配，勿用 startsWith——会误杀"武陵源风景名胜区十里画廊"）
    if (existingNames.has(n)) continue;                                         // 已在 locs（核心/地区/AI提议）
    if (otherAnchors.some(a => a.id !== anchor.id && haversineM(a, c) < 5000)) continue; // 跨锚点（如天门山扫描到七星山）
    if ([...locs, ...out].some(q => haversineM(q, c) < SUB_DEDUP_M)) continue;  // 距离去重（阈值见 SUB_DEDUP_M）
    // rank：0=AI 已知知名点（袁家界/百龙天梯等），1=官方景区名；2=杂点（茶百道/足道馆/高山流水）→ 丢弃
    const rank = aiKnown.has(n) || aiKnown.has(c.raw) ? 0 : /景区|风景|公园|名胜|自然保护区/.test(c.raw || "") ? 1 : 2;
    if (rank > 1) continue; // 拒绝杂点：否则扫描会把奶茶店/足道馆/小地名当子景点灌进来
    out.push({ ...c, rank });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out.slice(0, ANCHOR_CAP).map((c, i) => ({
    name: c.name, lat: c.lat, lng: c.lng,
    elevation: "", importance: 3, tags: ["子景点", `景区:${anchor.scenicName}`], scenic: anchor.scenicName,
  }));
}

// 给所有 loc 标注景区归属：锚点归自身；其余归最近锚点（<12km）；否则"独立"（只进主题游）。
function attachScenicTags(locs: any[], anchors: any[]) {
  for (const l of locs) {
    if (l.scenic) continue; // 子景点已标注
    const self = anchors.find(a => a.name === l.name || a.scenicName === l.name);
    if (self) { l.scenic = self.scenicName; continue; }
    let best: any = null, bestD = Infinity;
    for (const a of anchors) { const d = haversineM(a, l); if (d < bestD) { bestD = d; best = a; } }
    l.scenic = (best && bestD <= SUB_AREA_RADIUS) ? best.scenicName : "独立";
  }
  return locs;
}

// ── 确定性路线站点规划（路线组成=代码算，AI 只写 narrative/排序）────────────────
// 背景：路线站点曾由 DeepSeek 自由选择，AI 屡次不遵守景区分区规则（九寨沟/四姑娘山混入 2日、
// 七星山混入 2日、2日=1日+2点）。站点组成必须确定性：1日=前山核心、2日=前山+后山、
// 主题游=4热核心+统一地区景点。见 scripts/test-gaode.mjs 的 planRoutes 单测。
const CLUSTER_R = 8000; // 地区景点聚类半径：后山/五龙沟/白云万佛洞 相距 ~2-3km 成一簇，都江堰独立成簇

// 地区景点空间聚类：剔除与核心同坐标的重复点（青城山景区）→ 贪心聚类（距已有簇代表 <8km 并入）
function clusterRegionPts(locs: any[], corePool: any[]) {
  const pts = locs.filter((l: any) => (l.tags || []).includes("地区景点"))
    .filter((p: any) => !corePool.some((c: any) => haversineM(c, p) < SUB_DEDUP_M));
  const clusters: { rep: any; locs: any[] }[] = [];
  for (const p of pts) {
    const c = clusters.find((c) => haversineM(c.rep, p) < CLUSTER_R);
    if (c) c.locs.push(p);
    else clusters.push({ rep: p, locs: [p] });
  }
  return clusters;
}

// 簇代表：含 destName 前缀优先（青城后山 vs 五龙沟/白云万佛洞），否则 importance 高、名短
function pickRep(cluster: { locs: any[] }, destName: string): any {
  const d2 = destName.slice(0, 2);
  return cluster.locs.slice().sort((a: any, b: any) =>
    (b.importance || 3) - (a.importance || 3)
    || ((b.name.startsWith(d2) ? 1 : 0) - (a.name.startsWith(d2) ? 1 : 0))
    || (a.name.length - b.name.length)
  )[0];
}

// 路线组成规划。ctx: { coreScenicName, mainScenicName, destName, isNovelBased, novelName, hasRegionTour }
// 后山池（2日第2天）优先 mainScenicName（张家界：武陵源子景点 scan 时 scenic="武陵源"）；
// 为空（青城山：青城后山非锚点、region 点全被吸进核心 scenic）→ 地区景点空间聚类最大簇（≥2）。
function planRoutes(locs: any[], ctx: { coreScenicName: string; mainScenicName: string; destName: string; isNovelBased: boolean; novelName: string; hasRegionTour: boolean }) {
  const isRegion = (l: any) => (l.tags || []).includes("地区景点");
  const byImp = (a: any, b: any) => (b.importance || 3) - (a.importance || 3);
  // 核心池 = 前山（非地区景点、scenic===核心）→ 青城山 8 点
  const corePool = locs.filter((l: any) => !isRegion(l) && l.scenic === ctx.coreScenicName).sort(byImp);
  // 后山池
  let mainPool = ctx.mainScenicName ? locs.filter((l: any) => l.scenic === ctx.mainScenicName).sort(byImp) : [];
  if (!mainPool.length) {
    const clusters = clusterRegionPts(locs, corePool);
    const big = clusters.slice().sort((a, b) => b.locs.length - a.locs.length)[0];
    mainPool = big && big.locs.length >= 2 ? big.locs : [];
  }
  // 核心质心：判定后山池/统一景点是否「真正属于核心」的距离基准。
  // 西岭雪山(45km)/安仁古镇(44km) 是另一片区域，不该当 2日 day2 或 主题游 主力 —— 需距离过滤。
  const coreCenter = corePool.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
  const coreN = corePool.length || 1;
  const cc = { lng: coreCenter.lng / coreN, lat: coreCenter.lat / coreN };
  const nearCore = (l: any, maxM: number) => haversineM(cc, l) <= maxM;
  // 后山池必须距核心 ≤25km（青城后山 8-10km；西岭雪山 45km 是另一座山，排除）
  if (mainPool.length && !mainPool.every(l => nearCore(l, 25000))) mainPool = [];
  // 统一地区景点（主题游）只收核心周边 30km 内 —— 西岭/安仁等远点只当背景，不逐站罗列
  const unifiedRegion30 = clusterRegionPts(locs, corePool).map((c) => pickRep(c, ctx.destName)).filter((l: any) => nearCore(l, 30000));

  const plans: { label: string; title: string; allow: string[] | null }[] = [];
  // 1日精华游 = 前山核心 ≤8
  plans.push({ label: "1日精华游", title: `${ctx.destName}一日精华游`, allow: corePool.slice(0, 8).map((l) => l.id) });
  // 2日全景游 = 前山(第1天) + 后山(第2天)。无后山池时退化为核心池分两天
  if (mainPool.length) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: [...corePool.slice(0, 8).map((l) => l.id), ...mainPool.slice(0, 8).map((l) => l.id)] });
  } else if (corePool.length >= 8) {
    plans.push({ label: "2日全景游", title: `${ctx.destName}两日全景游`, allow: corePool.slice(0, 14).map((l) => l.id) });
  }
  // 主题游 = 4 热核心 + 统一地区景点（≤30km）
  if (ctx.hasRegionTour && unifiedRegion30.length) {
    plans.push({ label: "主题游", title: `${ctx.destName}深度主题游`, allow: [...corePool.slice(0, 4).map((l) => l.id), ...unifiedRegion30.map((l) => l.id)] });
  }
  // 文学巡礼线：AI 自由选点（保留）
  if (ctx.isNovelBased) plans.push({ label: "文学巡礼线", title: `《${ctx.novelName}》文学巡礼`, allow: null });
  return plans;
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
// "湖南张家界"（省名+市名连写，无"省/市"分隔符）→ {prov:"湖南", city:"张家界"}
const PROV_PREFIX = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)/;
// 是否整个串就是一个省级区划名（用于判定"城市"其实是裸省名 → 高德 city 参数无效）
const PROV_EXACT = /^(北京|天津|上海|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆|香港|澳门)$/;
function splitRegion(t: string) {
  const sheng = t.indexOf("省");
  if (sheng > -1) return { prov: t.slice(0, sheng + 1), city: t.slice(sheng + 1) };
  const zzq = t.indexOf("自治区");
  if (zzq > -1) return { prov: t.slice(0, zzq + 3), city: t.slice(zzq + 3) };
  const m = t.match(PROV_PREFIX); // "湖南张家界" → 匹配"湖南"前缀，剩余"张家界"是市
  if (m && m[0].length < t.length) return { prov: m[0], city: t.slice(m[0].length) };
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
  // 裸名（"江西""黄山""北京"、"湖南张家界"省名+市名连写）→ 先城市后省份匹配
  const gCityN = gCityCand.replace(/[市]$/g, ""); // "张家界市"→"张家界"
  if (gCityN && norm.includes(gCityN)) return true; // "湖南张家界"含"张家界" → 城市精确命中
  // 省份匹配仅限短目标（≤3 字：纯省名/直辖市名，如"湖南""江西""内蒙古"）
  // —— 否则"湖南张家界"这类连写串会把同省他市（株洲/长沙）的地点误放行
  if (norm.length <= 3) {
    const gProvN = gProv.replace(/省$/, ""); // "湖南省"→"湖南"
    return gProv.includes(norm) || (gProvN && norm.includes(gProvN));
  }
  return false;
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

// 有界并发映射：Edge Function 60s 预算内，把互相独立的网络调用并行化（如逐地点 gaode/regeo、内容分块）。
// 限制并发避免打爆高德限流/DeepSeek 限速。结果按下标归位，保持原顺序。
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
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

    // 目的地坐标：作所有高德搜索的 location 位置偏置。目的地地区是裸省名（如"四川"）时，
    // 没有偏置会把"祖师殿/朝阳洞/老君阁"等常见名解析到全省同名错点。
    const destLoc = destName ? await gaode(destName, destRegion).catch(() => null) : null;

    // 副标题：用户创建导览时没填 → AI 生成（短输出、与提取并行，不占关键路径）
    const subtitlePromise = (tour.subtitle || "").trim() ? Promise.resolve(null)
      : deepseek([
          { role: "system", content: "你是旅游文案策划。只返回JSON。" },
          { role: "user", content: `为「${destName}（${destRegion}）」的导览生成一句简短有文学意境的副标题（15-30字，用于首页卡片展示）。${tour.source?.title ? `源材料来自《${tour.source.title}》${tour.source.author ? `（${tour.source.author}）` : ""}` : ""}\n参考风格：\n- "跟着语文课本，登天都峰看奇石云海"\n- "循秦始皇足迹，登岱顶祭天封禅"\n- "天上白玉京 · 云上三清看奇峰"\n要求：点出目的地最核心的看点或文化记忆点，文学味浓，不要罗列地名，不要加书名号。JSON: {"subtitle":"一句话副标题"}` },
        ]).then((r: any) => String(r?.subtitle || "").trim()).catch(() => null);

    // 2. Extract locations
    const lr = await deepseek([
      { role: "system", content: "你是中国旅游规划专家。只返回JSON。只提取真实存在的地点，不确定的地点不要提取。只列固定旅游景点/地标/古迹/公园/山峰/宫观，不要临时展览、活动、演出、商业店铺等非固定地点。" },
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 6000)}\n\n提取目的地自身值得探访的地点：有文本时以文本提到的地点为准；文本为空时列出目的地自身及紧邻的真实名胜（山峰、宫观、栈道、园区、古迹等）。至少提取 8-12 个（景点多可更多）。宁可多列，坐标校验会过滤掉不存在的——不要遗漏真实景点。\nJSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
    ]);

    const warnings: string[] = [];
    let hasRegionTour = false; // 仅由下述确定性高德地区合并判定（AI 不稳定，不做依据）
    let aiAttractions: string[] = []; // AI 提议的著名景点/子景点名单（供子景点扫描 rank0 与去重用）
    const locs: any[] = [];
    // 与提取并行的地区准备：AI 提议知名景点 + 高德地区查询（与核心提取互不依赖，提前并发省 ~15s）
    const regionPrep = destRegion ? (async () => {
      const regionScenics = await gaodeRegionScenics(destRegion, destLoc || undefined).catch(() => []);
      let aiFromPrep: string[] = [];
      try {
        const rr2 = await deepseek([
          { role: "system", content: "你是中国旅游专家。只返回JSON。" },
          { role: "user", content: `目的地：${destName}（${destRegion}）。列出该地区除\"${destName}\"自身外、最值得一游的著名独立景点，以及 ${destName} 所在知名景区的著名子景点。只列真实存在、广为人知的著名景点。**若该知名景区有多个广为人知的著名子景点，必须全部列出、一个都不能漏，不要只挑最出名的几个**（示例：张家界武陵源的著名子景点为 天子山、黄石寨、杨家界、袁家界、金鞭溪、十里画廊、百龙天梯、水绕四门，若涉及武陵源必须全部包含）。独立景点（如宝峰湖、黄龙洞、张家界大峡谷）也一并列出。8-15 个，宁多勿漏。JSON: {\"attractions\":[\"名称1\",\"名称2\"]}` },
        ]);
        aiFromPrep = (rr2.attractions || []).map(String).filter(Boolean);
      } catch (e) { /* AI 提议失败不阻断 */ }
      return { regionScenics, aiAttractions: aiFromPrep };
    })() : Promise.resolve({ regionScenics: [], aiAttractions: [] as string[] });
    // 并行校验（原串行：12 地点 × gaode+regeo 两次往返 ≈ 10-20s，会吃满 60s 预算）
    const extract = await mapLimit(lr.locations || [], 6, async (l: any) => {
      const c = await gaode(l.name, destRegion, destLoc || undefined);
      if (!c || !c.lat) return { warn: `⚠️ "${l.name}" 未找到坐标，已跳过`, loc: null as any };
      // Verify coordinate is in the target region
      const geo = await regeo(c.lng, c.lat);
      if (geo === undefined) return { warn: `⚠️ "${l.name}" 坐标校验失败（高德 API 不可达），已跳过`, loc: null as any };
      if (geo === null) return { warn: `⚠️ "${l.name}" 坐标(${c.lng},${c.lat})无法解析，已跳过`, loc: null as any };
      if (!regionMatch(geo, destRegion)) return { warn: `⚠️ "${l.name}" 坐标(${c.lng},${c.lat})位于 ${geo.province}${geo.city || ''}，不在 ${destRegion}，已跳过`, loc: null as any };
      // Use Gaode's official name if available
      const displayName = c.name && c.name !== l.name ? c.name : l.name;
      return { warn: null, loc: { id: l.id, name: displayName, lat: c.lat, lng: c.lng, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [] } };
    });
    for (const r of extract) {
      if (r.warn) warnings.push(r.warn);
      if (r.loc) { r.loc.sort_order = locs.length; locs.push(r.loc); }
    }

    if (locs.length === 0) {
      // 防御：全部地点被坐标校验拒绝时不静默成功，置 status=error 便于用户看到失败原因
      throw new Error("未识别出任何有效地点：AI 提议名单全部被地区坐标校验拒绝（请检查目的地地区是否为规范省/市名）。");
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
    const afterExtractDedup = locs.length; // 报告用：地区/子景点并入会在此之后增长，不能拿去算 deduped
    console.log(`${locs.length} locations (${warnings.length} warnings)`);

    // 地区景点补充（确定性）：查询目的地区域知名景点，与核心所有点相距 >5km 的独立景点 ≥3 个
    // → 并入并触发主题游（不依赖 AI 随机判断；如张家界市并入国家森林公园/黄龙洞等）
    if (destRegion && locs.length >= 3) {
      try {
        // 地区准备已与核心提取并行启动（regionPrep），此处直接取结果
        const { regionScenics, aiAttractions: aiPrep } = await regionPrep;
        aiAttractions = aiPrep;
        // AI 提议的知名景点优先：著名子景点（袁家界/百龙天梯等）高德 types 查询召回不到，
        // 若排在 regionScenics 之后会被 20 上限挤掉 → 先收集 AI 点，regionScenics 再补足。
        const nameSeen = new Set<string>();
        const regionFinal: { lng: number; lat: number; name: string }[] = [];
        const aiPts = await mapLimit(aiAttractions.filter(n => !nameSeen.has(n)), 5, async (name: string) => {
          const c = await gaode(name, destRegion, destLoc || undefined);
          if (!c || !c.lat) return null;
          if (locs.some(l => haversineM(l, c) < 5000)) return null; // 距核心太近 → 非独立地区点
          return { lng: c.lng, lat: c.lat, name: c.name || name };
        });
        for (const p of aiPts) {
          if (!p) continue;
          const n = p.name;
          if (nameSeen.has(n)) continue;
          if (regionFinal.some(q => haversineM(q, p) < 1000)) continue; // 同坐标去重
          nameSeen.add(n);
          regionFinal.push(p);
        }
        // regionScenics 补足（名称级去重，防核心点如"天门山国家森林公园"被重复并入）
        for (const p of regionScenics) {
          if (regionFinal.some(q => haversineM(q, p) < 1000)) continue; // 同坐标（如武陵源/张家界国家森林公园）只留一个
          if (nameSeen.has(p.name)) continue;
          if (locs.some(l => String(l.name) === p.name)) continue; // 与核心地点同名（如"天门山国家森林公园"）→ 不重复并入
          nameSeen.add(p.name);
          regionFinal.push(p);
        }
        // 半径过滤：只并核心周边 REGION_RADIUS 内的地区点（目的地地区是裸省名如"四川"时，
        // 高德/AI 会把九寨沟/四姑娘山/峨眉山等整个省的名胜拉进来，150-500km 必须剔除）
        const coreCenter = locs.reduce((acc, l) => ({ lng: acc.lng + l.lng, lat: acc.lat + l.lat }), { lng: 0, lat: 0 });
        const coreN = locs.length || 1;
        const center = { lng: coreCenter.lng / coreN, lat: coreCenter.lat / coreN };
        const near = regionFinal.filter(p => haversineM(center, p) <= REGION_RADIUS);
        regionFinal.length = 0;
        regionFinal.push(...near);
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

    // 2.4 子景点确定性补全 + 景区归属（接线 gaodeAroundScenics，不依赖 AI 提议）
    // 解决：袁家界/十里画廊/水绕四门/杨家界等被高德 types 查询召回不到 → 靠周边扫描确定性拉取。
    const anchors = buildAnchors(locs, destName);
    try {
      // 只扫描非核心伞形/景区锚点（核心景区子景点已由 AI 提取覆盖；省 API 调用与时间）
      const scanAnchors = anchors.filter(a => a.weight >= 4 && !(destName && a.scenicName.includes(destName)));
      const aiKnown = new Set(aiAttractions);
      const subs: any[] = [];
      for (const a of scanAnchors.slice(0, 3)) {
        // 多点扫描：伞形锚点 + 子锚点坐标（武陵源横跨 30km+，单点覆盖不了金鞭溪/水绕四门等远端子景点）
        const points = [{ lng: a.lng, lat: a.lat, name: a.name }, ...(a.subPoints || [])].slice(0, 4);
        for (const pt of points) {
          try {
            const got = await scanAnchorSubs({ ...pt, scenicName: a.scenicName, id: a.id }, locs, anchors.filter(x => x.id !== a.id), aiKnown);
            for (const g of got) {
              if (subs.some(s => s.name === g.name || haversineM(s, g) < SUB_DEDUP_M)) continue; // 跨点去重
              subs.push(g);
            }
          } catch (e) { /* 单点扫描失败不阻断其他点 */ }
          if (subs.length >= SUB_TOTAL_CAP) break;
        }
        if (subs.length >= SUB_TOTAL_CAP) break;
      }
      const subsCapped = subs.slice(0, SUB_TOTAL_CAP).map((s, i) => ({ ...s, id: `sub-${locs.length + i}` }));
      for (const s of subsCapped) locs.push(s);
      locs.forEach((l, i) => (l.sort_order = i));
      attachScenicTags(locs, anchors);
      if (subsCapped.length) warnings.push(`🗺 子景点确定性补全 +${subsCapped.length} 个（景区归属标注）`);
    } catch (e) { /* 子景点扫描失败不阻断 */ }

    // 计算核心/主景区（供路线 prompt 分区：核心景区=第1天，主景区=第2天，其他独立景区只进主题游）
    // 核心锚点必须优先精确匹配 destName（"青城山"），否则"青城山景区前山"（含 destName 子串）会抢先
    // → scenicName="青城山前山" → 核心池匹配断裂、1日只剩 2 站。先查 cleanScenicName 或原名 === destName。
    const coreAnchor = anchors.find(a => destName && (a.name === destName || a.scenicName === destName))
      || anchors.find(a => destName && (a.name.includes(destName) || destName.includes(a.name)))
      || anchors[0] || null;
    const coreScenicName = coreAnchor?.scenicName || (destName || "");
    // 主景区须为真实景区（≥2 个子点）。"独立"是兜底标签不是景区——若让它当主景区，2日 day-2
    // 会被要求"只含独立景区站点"，把九寨沟/四姑娘山等远点全塞进来。无主景区时留空，2日 day-2 继续覆盖核心景区。
    const countByScenic = new Map<string, number>();
    for (const l of locs) if (l.scenic && l.scenic !== coreScenicName && l.scenic !== "独立") countByScenic.set(l.scenic, (countByScenic.get(l.scenic) || 0) + 1);
    let mainScenicName = "", maxC = -1;
    for (const [k, v] of countByScenic) if (v > maxC) { maxC = v; mainScenicName = k; }
    if (maxC < 2) mainScenicName = ""; // 没有 ≥2 子景区的非核心景区 → 无主景区

    // 3+4. Content 与 Routes 并行生成（互不依赖：路线只用 locs/id，内容独立按 loc 分批）。
    // 串行 4-6 个 DeepSeek 调用会吃满 Edge Function 60s 预算 → 两者并发，各内部再并行。
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

    // 4. Routes — 确定性站点规划：1日精华游(必有) + 2日全景游(前山+后山) + 主题游(4热核心+统一地区景点) + 文学巡礼线(小说源)
    // 路线「组成」由 planRoutes 代码决定（AI 屡次不遵守景区分区规则）；DeepSeek 只写 narrative + 站内排序。
    const isNovelBased = !!(tour.source?.title || tour.source?.novelTitle);
    const novelName = String(tour.source?.title || tour.source?.novelTitle || '');
    const plans = planRoutes(locs, { coreScenicName, mainScenicName, destName, isNovelBased, novelName, hasRegionTour });
    // 每条路线的指定站点清单（文学巡礼线无 allow，AI 自由选）
    const planText = plans.map((p, i) => {
      const stopsTxt = p.allow
        ? p.allow.map(id => { const l = locs.find(x => x.id === id); return l ? `${id}: ${l.name}` : id; }).join(", ")
        : "（文学巡礼线：自由选点）";
      return `${i + 1}. ${p.label}「${p.title}」 — 指定站点: ${stopsTxt}`;
    }).join("\n");

    const [contentById, routes] = await Promise.all([
      // 3. Content：按 ~8 个分批、并发生成（子景点并入后 locs 可达 25-40；单次输出超 max_tokens=8192 会截断 JSON → 分批）
      (async () => {
        const contentById = new Map<string, any>();
        const CONTENT_CHUNK = 8;
        const chunks: any[][] = [];
        for (let ci = 0; ci < locs.length; ci += CONTENT_CHUNK) chunks.push(locs.slice(ci, ci + CONTENT_CHUNK));
        const chunkResults = await mapLimit(chunks, 4, async (chunk) => {
          const cr = await deepseek([
            { role: "system", content: "你是文学旅游内容创作者。只返回JSON。" },
            { role: "user", content: `四层内容（📖文学意境/🏛历史掌故/🐉民间传说/🎭地域文化）。\n${chunk.map(l => `- ${l.id}: ${l.name}`).join("\n")}\n参考: ${src.slice(0, 4000)}\n\n每层150-250字。JSON: {"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
          ]);
          return cr.locations || [];
        });
        for (const cds of chunkResults) for (const cd of cds) if (cd?.id) contentById.set(cd.id, cd);
        return contentById;
      })(),
      // 4. Routes：与内容并行（只用 locs/id，不依赖内容）
      (async () => {
        let routes: any[] = [];
        for (let attempt = 0; attempt < 2 && routes.length < plans.length; attempt++) {
          const rr = await deepseek([
            { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
            { role: "user", content: `${destName}路线。**每条路线的站点已由系统指定，stops 必须恰好包含这些 id（可调整顺序使行走合理），严禁增删替换；文学巡礼线除外（可自由选点）。**\n\n${planText}\n\n要求：\n1. 每条路线按上面的指定站点生成完整行程（从入口/索道进 → 逐点游览 → 出口/索道出）。\n2. narrative 各写 150-300 字完整行程描述：从哪个入口/索道进、每段用什么交通（徒步/索道/观光车）、依次经过哪些地点、从哪里出。narrative 中必须写地点的中文名（如"玉京峰"），严禁写 id 代号。\n3. **2日全景游 narrative 必须明确「第1天前山」「第2天后山」各去哪**；主题游写明主题与串联逻辑。\n4. day_label 必须是上面给定的标签（1日精华游/2日全景游/主题游/文学巡礼线）。\n5. 地点少时压缩天数，严禁编造不存在的多日行程。\n6. stops 数组顺序必须与 narrative 中的实际游览顺序一致（入口/索道在前，依次游览，出口/索道在后）；stops 只能从上面指定 id 中逐字复制。\n7. 路线条数必须与上述完全一致（${plans.length} 条），缺一不可。\nJSON: {"routes":[{"day_label":"","title":"","stops":["id1","id2"],"narrative":"完整行程描述"}]}` },
          ]);
          // Route stop validation: resolve + 确定性兜底。
          // 注意：不能按数组下标取 plan（AI 返回 routes 的顺序常与 plans 不一致 → 会张冠李戴，
          // 2日 混入 西岭雪山 就是顺序错位导致的）。按 day_label 模糊匹配 plan，找不到才回退下标。
          // day_label/title/stops 全部以 plan 为准（路线组成 100% 确定），AI 只贡献 narrative 与站内相对顺序。
          const aiRoutes = rr.routes || [];
          const allRoutes = plans.map((plan: any, i: number) => {
            const ai = aiRoutes.find((x: any) => {
              const lbl = String(x?.day_label || "").trim();
              return lbl && (lbl.includes(plan.label) || plan.label.includes(lbl));
            }) || aiRoutes[i] || {};
            const rawStops: string[] = (Array.isArray(ai.stops) ? ai.stops : [])
              .map((s: any) => s && typeof s === "object" ? (s.poi ?? s.id ?? s.name) : s)
              .filter(Boolean);
            const resolved = rawStops.map((s: string) => resolveStop(s)).filter(Boolean);
            const unresolved = rawStops.filter((_, j) => !resolved[j]);
            if (unresolved.length > 0) {
              warnings.push(`⚠️ 路线"${ai.title || ai.day_label || `路线${i+1}`}"有 ${unresolved.length} 个站点无法匹配：${unresolved.join(', ')}`);
            }
            let stops: string[] = [];
            if (plan.allow) {
              const allowDb = plan.allow.map(id => slugToDbId.get(id)).filter(Boolean);
              const allowSet = new Set(allowDb);
              const keep = resolved.filter(s => allowSet.has(s));
              const extra = resolved.filter(s => !allowSet.has(s));
              const missing = allowDb.filter(id => !keep.includes(id));
              if (missing.length || extra.length) {
                if (missing.length) warnings.push(`♻️ 路线"${plan.label}"补齐缺失站点 ${missing.length} 个`);
                if (extra.length) warnings.push(`⚠️ 路线"${plan.label}"剔除多出站点 ${extra.length} 个`);
              }
              stops = [...keep, ...missing]; // 按 AI 相对顺序保留 allow 内站点 + 末尾补齐缺失
            } else {
              stops = resolved; // 文学巡礼线：AI 自由选点
            }
            return {
              id: `${scope}-r${i + 1}`,
              day_label: plan.label,
              title: plan.title,
              stops,
              narrative: typeof ai.narrative === "string" ? ai.narrative : "",
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
        return routes;
      })(),
    ]);

    // 应用内容到各地点（供写库）
    for (const l of locs) {
      const cd = contentById.get(l.id) || {};
      l.layers = cd.layers || {}; l.reflection = cd.reflection || ""; l.practical = cd.practical || {};
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
      deduped: extractedBeforeDedup - afterExtractDedup, // 坐标去重数（在地区/子景点并入前计算）
    };
    console.log(`Done! ${report.locations} locs, ${report.routes} routes, ${warnings.length} warnings`);
    // 副标题回写：用户没填时用 AI 生成的（≤40 字，防模型输出过长破坏卡片）
    const subtitle = await subtitlePromise;
    if (subtitle && subtitle.length <= 40) {
      await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}`, {
        method: "PATCH", headers: hdr, body: JSON.stringify({ subtitle }),
      }).catch(() => {});
    }
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
