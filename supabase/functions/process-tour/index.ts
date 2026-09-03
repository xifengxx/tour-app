// Supabase Edge Function: AI 自动处理导览
// 部署: npx supabase functions deploy process-tour --project-ref qxunedraoviaonjdanag --no-verify-jwt
// Secrets: supabase secrets set DEEPSEEK_API_KEY=sk-... GAODE_KEY=2ff1... --project-ref qxunedraoviaonjdanag

import { GAODE_KEY, hdr, SUPABASE_URL } from "./config.ts";
import { cors, deleteRows, json, postRows, setStatus } from "./http.ts";
import { deepseek, mapLimit } from "./ai.ts";
import { regeo } from "./gaode-validation.ts";
import { gaodeNearbyCulturalPOIs, JUNK_RE } from "./gaode-scan.ts";
import { AMUSE_RE, FACILITY_RE, gaode, gaodeRegionScenics } from "./gaode-search.ts";
import { haversineM } from "./geo.ts";
import { orderStopsGeographic, planRoutes as planRoutesModule } from "./routes.ts";
import { applyTrailGroups, getPrimaryTrailScenicName, getTrailNotes, injectTrailSeeds, orderStopsByTrail } from "./trail-routes.ts";
import { loadOrResearchRouteKnowledge } from "./route-knowledge.ts";
import { buildRouteLegs, estimateRouteDuration, planGraphStops, routeGraphIssues, routeGraphNotes, routeLegsText } from "./route-graph.ts";
import { attachScenicTags as attachScenicTagsModule, buildAnchors as buildAnchorsModule, scanAnchorSubs as scanAnchorSubsModule } from "./anchors.ts";
import { REGION_RADIUS, SUB_DEDUP_M, SUB_TOTAL_CAP } from "./anchors.ts";

// 规范化内容层结构：DeepSeek 分批生成时可能对部分点返回扁平结构（novel: "文本"）而非
// 嵌套结构（novel: {text: "文本"}）——实测青城山第二 chunk（地区景点）就返回了扁平结构，
// 前端 ContentCard 只读 .text → 显示为空。写库前统一转成嵌套 {text}。
function normalizeLayers(raw: any): any {
  if (!raw || typeof raw !== "object") return {};
  const out: any = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") out[k] = { text: v };
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = v; // 已是 {text}/{scenes}
    else out[k] = {};
  }
  return out;
}

// 离群点剔除：真实地点聚成簇，编造/过远点是离群点。
// 以候选点中位数为中心，迭代剔除 >20km 的点（最多 3 轮）。
// 不依赖地理编码中心 —— 某些目的地（三清山）地理编码会偏到行政中心，固定中心校验会误杀真景点。
// v70 簇感知恢复：被剔点若自身聚成 ≥2 点的簇（天门山+天门洞距武陵源 35km、张家界大峡谷），
// 是真实独立景区而非幻觉点 → 恢复；只有孤立远点才真剔除（张家界实测天门山被误杀）。
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
  if (pts.length < cands.length) {
    const removed = cands.filter(p => !pts.includes(p));
    const clusters: { rep: any; locs: any[] }[] = [];
    for (const p of removed) {
      const c = clusters.find(c => haversineM(c.rep, p) < CLUSTER_R);
      if (c) c.locs.push(p);
      else clusters.push({ rep: p, locs: [p] });
    }
    // 只有重要点簇才恢复；两个 importance 3 的远距离小庙容易是同名误定位（恒山实测混入大同市区庙宇）。
    for (const c of clusters) if (c.locs.length >= 2 && c.locs.some(l => (l.importance || 3) >= 4)) pts = [...pts, ...c.locs];
  }
  return pts;
}

const CLUSTER_R = 8000;

// ── Region helpers ─────────────────────────────────────────────
// "安徽省黄山市" → {prov:"安徽省", city:"黄山市"}; "黄山市" → {prov:"", city:"黄山市"}
// "湖南张家界"（省名+市名连写，无"省/市"分隔符）→ {prov:"湖南", city:"张家界"}
const stripSuffix = (s: any) => String(s).replace(/[市]$/g, "");

// Check if a location is plausibly in the expected region.
// 支持各种输入格式："安徽省黄山市"、"黄山市"、"黄山"、"北京"（直辖市）、"江西"（裸省名）、"江西省"。
// 规则：
//   1) 目标明确含"市"（省+市 或 裸市名）→ 城市必须匹配（直辖市用 province 兜底），省份不够。
//      v70：县级市/区县写法（"河南省登封市""河南登封""登封市"）——regeo 的 city 是上级市（郑州市），
//      必须同时拿 district（登封市）做候选，否则全部地点被拒 → locs=0 → status=error（嵩山实测实锤）。
//   2) 目标只含"省/自治区"（如"江西省""内蒙古自治区"）→ 省份匹配即可。
//   3) 目标是无后缀裸名（"江西""黄山"）→ 省或市任一匹配即可。
// 注意：高德 regeo 对直辖市返回 city=[]（空数组，truthy），须显式回退到 province。
function regionMatch(geo: { province: string; city: string | string[]; district?: string }, targetRegion: string): boolean {
  if (!geo) return false;
  const norm = String(targetRegion).trim();
  if (!norm) return false;
  const gProv = String(geo.province || "");
  const gCity = Array.isArray(geo.city) ? (geo.city[0] || "") : String(geo.city || "");
  const gCityCand = gCity || gProv; // 直辖市：city 为空 → 用 province 兜底
  const gDistrict = String(geo.district || ""); // v70：县级市/区县候选

  const sheng = norm.indexOf("省");
  const zzq = norm.indexOf("自治区");
  let provPart = "", cityPart = "";
  if (sheng > -1) { provPart = norm.slice(0, sheng); cityPart = norm.slice(sheng + 1); }
  else if (zzq > -1) { provPart = norm.slice(0, zzq); cityPart = norm.slice(zzq + 3); }

  if (cityPart) {
    // 明确指定了市 → 市或区县必须匹配
    const tCityCands = [cityPart, stripSuffix(cityPart)];
    return tCityCands.some(tc => tc && (
      gCityCand.includes(tc) || tc.includes(stripSuffix(gCityCand)) ||
      (gDistrict && (gDistrict.includes(tc) || tc.includes(stripSuffix(gDistrict))))
    ));
  }
  if (provPart) {
    // 只指定了省
    const tProvCands = [provPart, stripSuffix(provPart)];
    return tProvCands.some(tp => tp && gProv.includes(tp));
  }
  // 裸名（"江西""黄山""北京"、"湖南张家界"省名+市名连写）→ 先城市/区县后省份匹配
  const gCityN = gCityCand.replace(/[市]$/g, ""); // "张家界市"→"张家界"
  if (gCityN && norm.includes(gCityN)) return true; // "湖南张家界"含"张家界" → 城市精确命中
  const gDistN = gDistrict.replace(/[市区县]$/g, ""); // v70："登封市"→"登封"，覆盖裸县级市写法
  if (gDistN && norm.includes(gDistN)) return true;
  // 省份匹配仅限短目标（≤3 字：纯省名/直辖市名，如"湖南""江西""内蒙古"）
  // —— 否则"湖南张家界"这类连写串会把同省他市（株洲/长沙）的地点误放行
  if (norm.length <= 3) {
    const gProvN = gProv.replace(/省$/, ""); // "湖南省"→"湖南"
    return gProv.includes(norm) || (gProvN !== "" && norm.includes(gProvN));
  }
  return false;
}

const DEDUP_M = 150;
const INFRA_RE = /车站$|停车场|售票|游客中心|服务(?:中心|区|站|处)|管理处|管委会|监测|接待|讲解|卫生间|厕所|公交站|地铁站|候车|入口$|出口$|门店|商店|超市|银行|加油站/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let tourId: string | undefined;
  try {
    ({ tourId } = await req.json());
    if (!tourId) return json({ error: "Missing tourId" }, 400);
    // v70：早退路径也必须置 error——否则 status 永远停在 processing，前端无限转圈
    if (!GAODE_KEY) {
      await setStatus(tourId, "error", "GAODE_KEY 未配置（supabase secrets set GAODE_KEY=...）");
      return json({ error: "GAODE_KEY 未配置（supabase secrets set GAODE_KEY=...）" }, 500);
    }

    // 1. Fetch draft (use REST directly since service_role bypasses RLS)
    const rows = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=*`, { headers: hdr }).then(r => r.json());
    const tour = Array.isArray(rows) ? rows[0] : rows;
    if (!tour) {
      await setStatus(tourId, "error", "导览数据读取失败（可能已被删除）");
      return json({ error: "Tour not found" }, 404);
    }
    // 注意：此处不能再 setStatus("processing") —— 导览已由 INSERT/UPDATE 触发器置为 processing，
    // 再设一次会触发 UPDATE 触发器 → 函数被并发调用两次（双重写导致数据错乱）。

    const destName = tour.destination?.name || "";
    const destRegion = tour.destination?.region || "";
    const src = tour.source?.rawText || "";
    const routeKnowledge = await loadOrResearchRouteKnowledge(destName, destRegion, tour.destination?.type);
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

    // 2. Extract locations（v70：temperature 0.7→0.2，提取/路线要稳定性；源文本 6000→12000 字）
    const lr = await deepseek([
      { role: "system", content: "你是中国旅游规划专家。只返回JSON。只提取真实存在的地点，不确定的地点不要提取。只列固定旅游景点/地标/古迹/公园/山峰/宫观，不要临时展览、活动、演出、商业店铺等非固定地点。" },
      { role: "user", content: `目的地：${destName}（${destRegion}）\n文本：${src.slice(0, 12000)}\n\n提取目的地自身值得探访的地点：有文本时以文本提到的地点为准；文本为空时列出目的地自身及紧邻的真实名胜（山峰、宫观、栈道、园区、古迹等）。至少提取 8-12 个（景点多可更多）。宁可多列，坐标校验会过滤掉不存在的——不要遗漏真实景点。\nJSON: {"locations":[{"id":"en-id","name":"地点","importance":1-5,"elevation":"","tags":[]}]}` },
    ], { temperature: 0.2 });

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
        ], { temperature: 0.2 });
        aiFromPrep = (rr2.attractions || []).map(String).filter(Boolean);
      } catch { /* AI 提议失败不阻断 */ }
      return { regionScenics, aiAttractions: aiFromPrep };
    })() : Promise.resolve({ regionScenics: [], aiAttractions: [] as string[] });
    // 核心景区二次提议：第一轮提取偶发只给山顶/山腰点，漏掉半山庙宇和山脚殿宇（恒山实测漏真武庙、三清殿）。
    // 只问“景区内部/紧邻入口”，避免市域独立景点混入；后续仍必须过高德定位、区域校验和核心距离校验。
    const corePrep = destName ? deepseek([
      { role: "system", content: "你是景区动线专家。只返回JSON。只列固定旅游景点/古迹/建筑/山岭/峡口，不确定的不要列。" },
      { role: "user", content: `列出「${destName}」景区内部及紧邻入口/游客中心的固定游览点，不要列 ${destRegion || "所在地区"} 的其他独立景区。\n必须覆盖：主峰/山顶点、半山自然或文化节点、山脚/入口处的庙宇殿堂宫观祠院、外围峡谷或悬崖建筑。不要餐饮、住宿、停车场、售票处、商店、公交站和商业设施。至少 10-16 个，宁多勿漏，由坐标校验过滤。\nJSON: {"locations":[{"id":"core-en-id","name":"地点","importance":3-5}]}` },
    ], { temperature: 0 }).catch(() => ({ locations: [] })) : Promise.resolve({ locations: [] });
    // 并行校验（原串行：12 地点 × gaode+regeo 两次往返 ≈ 10-20s，会吃满 60s 预算）
    // v70：并发 6→4，配合 gaode 限流退避，减少 CUQPS 随机丢点（天子山/袁家界实锤）
    const extract = await mapLimit(lr.locations || [], 4, async (l: any) => {
      const c = await gaode(l.name, destRegion, destLoc || undefined);
      if (!c || !c.lat) return { warn: `⚠️ "${l.name}" 未找到坐标，已跳过`, loc: null as any };
      // Verify coordinate is in the target region
      const geo = await regeo(c.lng, c.lat);
      if (geo === undefined) return { warn: `⚠️ "${l.name}" 坐标校验失败（高德 API 不可达），已跳过`, loc: null as any };
      if (geo === null) return { warn: `⚠️ "${l.name}" 坐标(${c.lng},${c.lat})无法解析，已跳过`, loc: null as any };
      if (!regionMatch(geo, destRegion)) return { warn: `⚠️ "${l.name}" 坐标(${c.lng},${c.lat})位于 ${geo.province}${geo.city || ''}，不在 ${destRegion}，已跳过`, loc: null as any };
      // Use Gaode's official name if available
      const displayName = c.name && c.name !== l.name ? c.name : l.name;
      // 首层提取拒绝服务设施；不用 FACILITY_RE，避免误杀“金龙峡栈道”这类真实游览点。
      if (INFRA_RE.test(displayName) || JUNK_RE.test(displayName) || AMUSE_RE.test(displayName)) {
        return { warn: `⚠️ "${displayName}" 是服务/商业设施，已跳过`, loc: null as any };
      }
      return { warn: null, loc: { id: l.id, name: displayName, lat: c.lat, lng: c.lng, elevation: l.elevation || "", importance: l.importance || 3, tags: l.tags || [] } };
    });
    for (const r of extract) {
      if (r.warn) warnings.push(r.warn);
      if (r.loc) { r.loc.sort_order = locs.length; locs.push(r.loc); }
    }

    if (locs.length === 0) {
      // 防御：全部地点被坐标校验拒绝时不静默成功，置 status=error 便于用户看到失败原因
      throw new Error(`未识别出任何有效地点：AI 提议名单全部被地区坐标校验拒绝。目的地地区「${destRegion}」可能不是规范省/市名（如景点在县级市，请填其上级市，如"河南省郑州市"而非"登封"）。`);
    }
    if (locs.length < 3) {
      // v70：1-2 个地点也"成功"等于产出一个空导览 → 按失败处理并给出可操作的提示
      throw new Error(`仅识别出 ${locs.length} 个有效地点，不足以生成导览。请检查目的地地区填写（${destRegion}），或在源文本中补充景点介绍。`);
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

    // 核心景区补全：只有核心池不足 10 个时才启用，补足山脚/半山关键点。
    const coreCountBeforeRepair = locs.filter(l => !(l.tags || []).includes("地区景点")).length;
    if (coreCountBeforeRepair < 10) {
      const coreSeedList = locs.filter(l => !(l.tags || []).includes("地区景点"));
      const coreSeed = coreSeedList.slice().sort((a, b) => (b.importance || 3) - (a.importance || 3))[0] || destLoc;
      const proposed = ((await corePrep).locations || []).filter((l: any) => l?.name).slice(0, 20);
      const repaired = await mapLimit(proposed, 4, async (l: any, proposalIndex: number) => {
        const c = await gaode(l.name, destRegion, destLoc || undefined).catch(() => null);
        if (!c || !c.lat) return null;
        const n = String(c.name || l.name || "");
        if (!/庙|殿|宫|道观|祠|寺|塔|阁|窟|洞|亭|坊|碑|石刻|岭|口|峡|栈道/.test(n)) return null;
        if (/餐|饮|饭|店$|早点|早餐|小吃|停车场|售票|游客中心|观光|索道(?:站|入口|出口)?$|公交站|地铁站|卫生间|厕所|管理处|服务处/.test(n)) return null;
        if (FACILITY_RE.test(n) || JUNK_RE.test(n) || AMUSE_RE.test(n)) return null;
        if (locs.some(l2 => String(l2.name) === n || haversineM(l2, c) < DEDUP_M)) return null;
        if (!coreSeed || haversineM(coreSeed, c) > 5000) return null;
        const geo = await regeo(c.lng, c.lat);
        if (!geo || !regionMatch(geo, destRegion)) return null;
        return {
          id: `core-repair-${proposalIndex}`, name: n, lat: c.lat, lng: c.lng, elevation: "",
          importance: /庙|殿|宫|道观|祠/.test(n) ? 4 : 3, tags: ["子景点", "核心补全"],
          layers: {}, reflection: "", practical: {}, scenic: destName,
        };
      });
      const wantedRepairs = Math.min(10 - coreCountBeforeRepair, 5);
      let validRepaired = repaired.filter((l): l is any => !!l).slice(0, wantedRepairs);
      // AI 提议仍可能漏掉高评分庙殿（恒山漏三清殿）。高德周边扫描按评分兜底，
      // 只补 5km 内的文化类固定景点，避免回到早期“周边扫描污染”的做法。
      if (validRepaired.length < wantedRepairs && coreSeed) {
        try {
          const [nearbyCultural, nearbyNature] = await Promise.all([
            gaodeNearbyCulturalPOIs(coreSeed.lng, coreSeed.lat, 5000),
            gaodeNearbyCulturalPOIs(coreSeed.lng, coreSeed.lat, 5000, "风景名胜;旅游景点"),
          ]);
          let nearbyCandidates = [
            ...nearbyCultural,
            ...nearbyNature.filter(p => /峰|岭|口|峡|栈道|洞|亭|台|谷|岩|石|松|门|府/.test(p.name)),
          ]
            .filter(p => {
              const cultural = /庙|殿|宫|道观|祠|寺|观$/.test(p.name);
              const natural = /峰|岭|口|峡|栈道|洞|亭|台|谷|岩|石|松|门|府/.test(p.name);
              return (cultural || natural) && p.rating >= (cultural ? 3.5 : 3.0);
            })
            .filter(p => !INFRA_RE.test(p.name) && !JUNK_RE.test(p.name) && !AMUSE_RE.test(p.name))
            .filter(p => ![...locs, ...validRepaired].some(q => String(q.name) === p.name || haversineM(q, p) < DEDUP_M))
            .sort((a, b) => {
              const rank = (n: string) => /庙$|殿$|宫$|祠$/.test(n) ? 3 : /寺$|观$/.test(n) ? 2 : /峰|岭|口|峡|栈道|洞|亭|台|谷|岩|石|松|门|府/.test(n) ? 1 : 0;
              return rank(b.name) - rank(a.name) || b.rating - a.rating || a.name.length - b.name.length;
            });
          const repairNeeded = wantedRepairs - validRepaired.length;
          // 山地动线的关键“口/岭/峡”节点常被高评分庙殿挤掉，保留一个目的地名前缀的自然节点名额。
          const naturalMust = nearbyCandidates.find(p => destName && p.name.includes(destName) && /口|岭|峡|栈道/.test(p.name));
          if (naturalMust) nearbyCandidates = [naturalMust, ...nearbyCandidates.filter(p => p !== naturalMust)];
          const scannedRepairs = await mapLimit(nearbyCandidates.slice(0, Math.max(repairNeeded * 3, repairNeeded)), 4, async (p, i: number) => {
            const geo = await regeo(p.lng, p.lat);
            if (!geo || !regionMatch(geo, destRegion)) return null;
            return {
              id: `core-scan-${i}`, name: p.name, lat: p.lat, lng: p.lng, elevation: "",
              importance: 4, tags: ["子景点", "核心补全", "高德扫描"],
              layers: {}, reflection: "", practical: {}, scenic: destName,
            };
          });
          for (const l of scannedRepairs.filter((l): l is any => !!l).slice(0, repairNeeded)) {
            (l as any).sort_order = locs.length;
            locs.push(l);
            validRepaired.push(l);
          }
        } catch { /* 周边扫描失败时保留 AI 提议结果 */ }
      }
      for (const l of validRepaired) { (l as any).sort_order = locs.length; locs.push(l); }
      if (validRepaired.length) warnings.push(`🏔 核心子景点补全 +${validRepaired.length} 个：${validRepaired.map(l => l.name).join("/")}`);
    }

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
          // v70：AI 提议点同样过设施/餐饮/游乐过滤——"老院子饭庄(永定大道)""普光禅寺(公交站)"曾直接并入
          if (FACILITY_RE.test(c.name) || JUNK_RE.test(c.name) || AMUSE_RE.test(c.name) || /公交站|地铁站/.test(c.name)) return null;
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
          // v70：名称含目的地名的点（"嵩山国家重点风景名胜区""中国·嵩山世界地质公园"）是目的地自身/别名，
          // 并入后会作为"地区景点"混进主题游 → 剔除；cap 20→12、importance 4→3（不该压过核心点）
          const final = regionFinal.filter(p => !(destName && (p.name.includes(destName) || destName.includes(p.name))));
          if (final.length < 3) { console.log("Region merge skipped: only destination aliases within radius"); }
          else {
          const addN = Math.min(12, final.length);
          for (const p of final.slice(0, addN)) {
            locs.push({ id: `reg-${locs.length}`, name: p.name, lat: p.lat, lng: p.lng, elevation: "", importance: 3, tags: ["地区景点"], layers: {}, reflection: "", practical: {} });
          }
          locs.forEach((l, i) => (l.sort_order = i));
          hasRegionTour = true;
          warnings.push(`🌏 自动并入 ${addN} 个地区知名景点（可组主题游）`);
          }
        }
      } catch { /* 区域查询失败不阻断 */ }
    }

    // 2.4 子景点确定性补全 + 景区归属（接线 gaodeAroundScenics，不依赖 AI 提议）
    // 解决：袁家界/十里画廊/水绕四门/杨家界等被高德 types 查询召回不到 → 靠周边扫描确定性拉取。
    const anchors = buildAnchorsModule(locs, destName);
    // 山岳目的地可能提取不到带“景区/风景名胜区”后缀的伞形锚点（嵩山实测只有神州第一圣地/少林寺等），
    // 但目的地坐标本身是高德稳定返回的核心点。此时不能让全部点落到“独立”→ corePool=0 → 一日线消失。
    if (!anchors.length && destLoc && tour.destination?.type === "mountain") {
      anchors.push({
        id: "destination-core", name: destName, scenicName: destName, lat: destLoc.lat, lng: destLoc.lng,
        elevation: "", importance: 5, tags: [], weight: 99, mergedNames: [], subPoints: [],
      });
      warnings.push(`⛰ 未识别出景区锚点，已用目的地坐标「${destName}」作为核心锚点`);
    }
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
            const got = await scanAnchorSubsModule({ ...pt, scenicName: a.scenicName, id: a.id }, locs, anchors.filter(x => x.id !== a.id), aiKnown);
            for (const g of got) {
              if (subs.some(s => s.name === g.name || haversineM(s, g) < SUB_DEDUP_M)) continue; // 跨点去重
              subs.push(g);
            }
          } catch { /* 单点扫描失败不阻断其他点 */ }
          if (subs.length >= SUB_TOTAL_CAP) break;
        }
        if (subs.length >= SUB_TOTAL_CAP) break;
      }
      const subsCapped = subs.slice(0, SUB_TOTAL_CAP).map((s, i) => ({ ...s, id: `sub-${locs.length + i}` }));
      for (const s of subsCapped) locs.push(s);
      locs.forEach((l, i) => (l.sort_order = i));
      attachScenicTagsModule(locs, anchors);
      if (subsCapped.length) warnings.push(`🗺 子景点确定性补全 +${subsCapped.length} 个（景区归属标注）`);
    } catch { /* 子景点扫描失败不阻断 */ }

    // 计算核心/主景区（供路线 prompt 分区：核心景区=第1天，主景区=第2天，其他独立景区只进主题游）
    // 核心锚点必须优先精确匹配 destName（"青城山"），否则"青城山景区前山"（含 destName 子串）会抢先
    // → scenicName="青城山前山" → 核心池匹配断裂、1日只剩 2 站。先查 cleanScenicName 或原名 === destName。
    const coreAnchor = anchors.find(a => destName && (a.name === destName || a.scenicName === destName))
      || anchors.find(a => destName && (a.name.includes(destName) || destName.includes(a.name)))
      || anchors[0] || null;
    const trailGroupNames = applyTrailGroups(locs, destName, routeKnowledge.trails);
    if (trailGroupNames.length) warnings.push(`🥾 已知多山线路分区：${trailGroupNames.join("/")}`);
    const primaryTrailScenicName = getPrimaryTrailScenicName(destName, routeKnowledge.trails);
    const coreScenicName = primaryTrailScenicName || coreAnchor?.scenicName || (destName || "");
    // 主景区须为真实景区（≥2 个子点）。"独立"是兜底标签不是景区——若让它当主景区，2日 day-2
    // 会被要求"只含独立景区站点"，把九寨沟/四姑娘山等远点全塞进来。无主景区时留空，2日 day-2 继续覆盖核心景区。
    const countByScenic = new Map<string, number>();
    for (const l of locs) if (l.scenic && l.scenic !== coreScenicName && l.scenic !== "独立") countByScenic.set(l.scenic, (countByScenic.get(l.scenic) || 0) + 1);
    let mainScenicName = "", maxC = -1;
    for (const [k, v] of countByScenic) if (v > maxC) { maxC = v; mainScenicName = k; }
    if (maxC < 2) mainScenicName = ""; // 没有 ≥2 子景区的非核心景区 → 无主景区

    // 5. Known-trail layer：知名山岳用策展动线补关键点并固定站序。
    // “地理最近邻”只能保证空间连贯，不知道“真武庙在虎风口下方、三清殿在山脚游客中心”
    // 这类步道/换乘事实；恒山实测会继续产出上下锯齿。
    const trailSeedNames = injectTrailSeeds(locs, destName, coreScenicName, routeKnowledge.trails);
    if (trailSeedNames.length) warnings.push(`🥾 已知步道补全 +${trailSeedNames.length} 个：${trailSeedNames.join("/")}`);

    // 3+4. Content 与 Routes 并行生成（互不依赖：路线只用 locs/id，内容独立按 loc 分批）。
    // 串行 4-6 个 DeepSeek 调用会吃满 Edge Function 60s 预算 → 两者并发，各内部再并行。
    // DeepSeek ids (slugs like "r1", "yujing-feng") are NOT globally unique,
    // but locations.id / routes.id are global primary keys. Scope them per tour
    // or writes collide with other tours (409 duplicate key).
    const scope = tourId.slice(0, 8);
    const slugToDbId = new Map(locs.map(l => [l.id, `${scope}-${l.id}`]));
    // 数据库 id 视图的地点列表（供地理排序用：stops 存的是 db id）
    const dbLocs = locs.map(l => ({ ...l, id: slugToDbId.get(l.id) || l.id }));
    const trailNotes = getTrailNotes(destName, dbLocs, routeKnowledge.trails);
    const orderStops = (stopIds: string[], source: any[]) => {
      // v81：优先用真实路线图做“整段分区 + 段内步道顺序”，避免太室山/少室山这类
      // 多徒步区被地理最近邻或重要性排序穿插。研究/策展资料缺分区时仍走旧层。
      const graphOrdered = planGraphStops(stopIds, source, routeKnowledge);
      const trailOrdered = graphOrdered.length
        ? graphOrdered
        : orderStopsByTrail(stopIds, source, destLoc, destName, routeKnowledge.trails);
      return trailOrdered.length ? trailOrdered : orderStopsGeographic(stopIds, source, destLoc);
    };

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
    // 路线「组成」由 planRoutes 代码决定（AI 屡次不遵守景区分区规则）；站内顺序 v71 起由代码地理最近邻
    // 确定（AI 无坐标信息，锯齿动线实测恒山），DeepSeek 只写 narrative。
    const isNovelBased = !!(tour.source?.title || tour.source?.novelTitle);
    const novelName = String(tour.source?.title || tour.source?.novelTitle || '');
    const corePoolSize = locs.filter(l => !(l.tags || []).includes("地区景点") && l.scenic === coreScenicName).length;
    const plans = planRoutesModule(locs, { coreScenicName, mainScenicName, destName, isNovelBased, novelName, hasRegionTour });
    // 站内顺序在调 AI 前排定，planText 即最终动线，AI 的 narrative 按此顺序展开
    for (const p of plans) {
      if (p.allow) p.allow = orderStops(p.allow, locs);
    }
    // 每条路线单独生成交通 legs：1日/2日只描述本线衔接，主题游的长距离接驳不污染普通徒步线。
    const routeTrafficHints = new Map(plans.map(plan => [plan.label, plan.allow ? routeLegsText(buildRouteLegs(plan.allow, locs, routeKnowledge)) : ""]));
    const graphNotes = routeGraphNotes(plans.flatMap(p => p.allow || []), dbLocs, routeKnowledge);
    // 每条路线的指定站点清单（文学巡礼线无 allow，AI 自由选）
    const planText = plans.map((p, i) => {
      const stopsTxt = p.allow
        ? p.allow.map(id => { const l = locs.find(x => x.id === id); return l ? `${id}: ${l.name}` : id; }).join(", ")
        : "（文学巡礼线：自由选点）";
      const traffic = routeTrafficHints.get(p.label);
      return `${i + 1}. ${p.label}「${p.title}」 — 指定站点: ${stopsTxt}${traffic ? `\n   交通衔接（narrative 必须按此执行）: ${traffic}` : ""}`;
    }).join("\n");

    const [contentById, routes] = await Promise.all([
      // 3. Content：按 ~5 个分批、并发生成（子景点并入后 locs 可达 25-40）。
      // v70 容错重写（v69 一个 chunk 失败 → 整个 Promise.all 崩 → status=error）：
      //   - chunk 8→5 + 每层 150-250→120-180 字：单 chunk 输出不再顶到 max_tokens=8192 截断
      //   - finish_reason=length（截断）→ 自动拆半重试；其他失败 → 单点补生成；仍失败 → 记告警不阻断
      //   - AI 没逐字复制 id → 按名称兜底匹配；全部结束后完整性检查 + 缺失单点补生成
      (async () => {
        const contentById = new Map<string, any>();
        const CONTENT_CHUNK = 5;
        const chunks: any[][] = [];
        for (let ci = 0; ci < locs.length; ci += CONTENT_CHUNK) chunks.push(locs.slice(ci, ci + CONTENT_CHUNK));
        const promptFor = (chunk: any[]) => [
          { role: "system", content: "你是文学旅游内容创作者。只返回JSON。" },
          { role: "user", content: `四层内容（📖文学意境/🏛历史掌故/🐉民间传说/🎭地域文化）。\n${chunk.map(l => `- ${l.id}: ${l.name}`).join("\n")}\n参考: ${src.slice(0, 6000)}\n\n每层120-180字。id 必须逐字复制上面给定的 id，不得改写。JSON: {"locations":[{"id":"","layers":{"novel":{"text":""},"history":{"text":""},"folklore":{"text":""},"customs":{"text":""}},"reflection":"","practical":{"access":"","difficulty":"","bestTime":"","tip":""}}]}` },
        ];
        const runChunk: (chunk: any[]) => Promise<any[]> = async (chunk) => {
          try {
            const cr = await deepseek(promptFor(chunk));
            return cr.locations || [];
          } catch (e: any) {
            if (e.truncated && chunk.length > 1) {
              // 输出截断：拆半分别生成，合并结果
              const mid = Math.ceil(chunk.length / 2);
              const [a, b] = await Promise.all([runChunk(chunk.slice(0, mid)), runChunk(chunk.slice(mid))]);
              return [...a, ...b];
            }
            // 其他失败：逐点单点重试，保住能保住的
            warnings.push(`⚠️ 内容批次（${chunk.map(l => l.name).join("/")}）生成失败：${e.message}，转单点补生成`);
            const single = await mapLimit(chunk, 3, async (l: any) => {
              try {
                const cr = await deepseek(promptFor([l]));
                return ((cr.locations || [])[0]) || null;
              } catch (e2: any) { warnings.push(`⚠️ "${l.name}" 内容补生成失败：${e2.message}`); return null; }
            });
            return single.filter(Boolean);
          }
        };
        const chunkResults = await mapLimit(chunks, 3, runChunk);
        for (const cds of chunkResults) for (const cd of cds) if (cd?.id) contentById.set(cd.id, cd);
        // 按名兜底：AI 返回的 id 与给定 id 不一致（改名/翻译差异）时，内容不再静默丢失
        for (const cd of [...contentById.values()]) {
          if (locs.some(l => l.id === cd.id)) continue;
          const hit = locs.find(l => l.name === cd.id || String(cd.id).includes(l.name) || l.name.includes(String(cd.id)));
          if (hit && !contentById.has(hit.id)) { contentById.set(hit.id, cd); warnings.push(`♻️ 内容 id"${cd.id}" 按名匹配到 "${hit.name}"`); }
        }
        // 完整性检查：任何 loc 没拿到内容 → 单点补生成一轮；仍缺 → 告警可见，不阻断
        const missing = locs.filter(l => !contentById.has(l.id));
        if (missing.length) {
          warnings.push(`⚠️ ${missing.length} 个地点内容缺失，单点补生成：${missing.map(l => l.name).join("/")}`);
          const filled = await mapLimit(missing, 3, async (l: any) => {
            try { const cr = await deepseek(promptFor([l])); return ((cr.locations || [])[0]) || null; }
            catch (e: any) { warnings.push(`⚠️ "${l.name}" 内容最终缺失：${e.message}`); return null; }
          });
          for (const cd of filled) if (cd?.id) {
            const hit = locs.find(l => l.id === cd.id || l.name === cd.id);
            if (hit) contentById.set(hit.id, cd);
          }
        }
        return contentById;
      })(),
      // 4. Routes：与内容并行（只用 locs/id，不依赖内容）
      (async () => {
        let routes: any[] = [];
        for (let attempt = 0; attempt < 2 && routes.length < plans.length; attempt++) {
          const rr = await deepseek([
            { role: "system", content: "你是旅游路线规划师。只返回JSON。" },
            { role: "user", content: `${destName}路线。**每条路线的站点及其顺序已由系统按地理动线排定，stops 必须严格按给定顺序逐字输出（这是实际游览顺序，已保证不走回头路），严禁增删替换或调整顺序；文学巡礼线除外（可自由选点与排序）。**\n\n${planText}\n\n${trailNotes ? `参考真实动线：${trailNotes}\n\n` : ""}${graphNotes ? `路线衔接：${graphNotes}\n\n` : ""}要求：\n1. 每条路线按上面的指定站点生成完整行程（从入口/索道进 → 逐点游览 → 出口/索道出）。\n2. narrative 各写 150-300 字完整行程描述：从哪个入口/索道进、每段用什么交通（徒步/索道/观光车）、依次经过哪些地点、从哪里出。narrative 中必须写地点的中文名（如"玉京峰"），严禁写 id 代号。narrative 的游览顺序必须与给定站点顺序一致。山地路线从半山下降到山脚庙宇/游客中心/停车场，或从游客中心前往外围峡谷/悬空景点时，必须写清换乘观光车、摆渡车或专车，不要把长距离位移写成连续徒步。\n3. **2日全景游 narrative 必须明确「第1天前山」「第2天后山」各去哪**；主题游写明主题与串联逻辑。\n4. day_label 必须是上面给定的标签（1日精华游/2日全景游/主题游/文学巡礼线）。\n5. 地点少时压缩天数，严禁编造不存在的多日行程。\n6. stops 数组顺序必须与 narrative 中的实际游览顺序一致（入口/索道在前，依次游览，出口/索道在后）；stops 只能从上面指定 id 中逐字复制。\n7. 路线条数必须与上述完全一致（${plans.length} 条），缺一不可。\nJSON: {"routes":[{"day_label":"","title":"","stops":["id1","id2"],"narrative":"完整行程描述"}]}` },
          ], { temperature: 0.2 });
          // Route stop validation: resolve + 确定性兜底。
          // 注意：不能按数组下标取 plan（AI 返回 routes 的顺序常与 plans 不一致 → 会张冠李戴，
          // 2日 混入 西岭雪山 就是顺序错位导致的）。按 day_label 模糊匹配 plan，找不到才回退下标。
          // day_label/title/stops 全部以 plan 为准（路线组成 100% 确定），AI 只贡献 narrative 与站内相对顺序。
          const aiRoutes = rr.routes || [];
          const allRoutes = plans.map((plan, i: number) => {
            const ai = aiRoutes.find((x: any) => {
              const lbl = String(x?.day_label || "").trim();
              return lbl && (lbl.includes(plan.label) || plan.label.includes(lbl));
            }) || aiRoutes[i] || {};
            const rawStops: string[] = (Array.isArray(ai.stops) ? ai.stops : [])
              .map((s: any) => s && typeof s === "object" ? (s.poi ?? s.id ?? s.name) : s)
              .filter(Boolean);
            const resolved = rawStops.map((s: string) => resolveStop(s)).filter((s): s is string => !!s);
            const unresolved = rawStops.filter((_, j) => !resolved[j]);
            if (unresolved.length > 0) {
              warnings.push(`⚠️ 路线"${ai.title || ai.day_label || `路线${i+1}`}"有 ${unresolved.length} 个站点无法匹配：${unresolved.join(', ')}`);
            }
            let stops: string[] = [];
            if (plan.allow) {
              const allowDb = plan.allow.map(id => slugToDbId.get(id)).filter((id): id is string => !!id);
              const allowSet = new Set(allowDb);
              const keep = resolved.filter(s => allowSet.has(s));
              const extra = resolved.filter(s => !allowSet.has(s));
              const missing = allowDb.filter(id => !keep.includes(id));
              if (missing.length || extra.length) {
                if (missing.length) warnings.push(`♻️ 路线"${plan.label}"补齐缺失站点 ${missing.length} 个`);
                if (extra.length) warnings.push(`⚠️ 路线"${plan.label}"剔除多出站点 ${extra.length} 个`);
              }
              // v71：站点集合仍由代码确定（keep ∪ allowDb，Set 兜底去重——天门山 1日 AI 曾把
              // 入口/出口重复），顺序以地理最近邻为准，AI 顺序不再参与
              stops = orderStops([...new Set([...keep, ...allowDb])], dbLocs);
            } else {
              stops = resolved; // 文学巡礼线：AI 自由选点
              // v70.3 诊断：文学巡礼线选点结果总是记进报告（线上 3/4 路线问题定位用）
              warnings.push(`📖 路线"${plan.label}"AI 自由选点 resolve ${resolved.length} 站（raw ${rawStops.length} 站）`);
              // v70.3：自由选点全部无法 resolve 时不静默丢路线（黄山实测 routes 3/4）——
              // 回退到核心高重要性 4 站，保证小说源导览必有文学巡礼线
              if (!stops.length) {
                const fallback = locs.filter(l => !(l.tags || []).includes("地区景点"))
                  .slice().sort((a, b) => (b.importance || 3) - (a.importance || 3)).slice(0, 4);
                const fallbackIds = fallback.map(l => slugToDbId.get(l.id)).filter((id): id is string => !!id);
                stops = orderStops(fallbackIds, dbLocs);
                if (stops.length) warnings.push(`♻️ 路线"${plan.label}"AI 选点无法匹配，回退核心 ${stops.length} 站`);
              }
            }
            return {
              id: `${scope}-r${i + 1}`,
              day_label: plan.label,
              title: plan.title,
              stops,
              narrative: typeof ai.narrative === "string" ? ai.narrative : "",
              sort_order: i,
              _free: !plan.allow, // v70.4：自由选点路线（文学巡礼线）标记，去重时跳过
            };
          }).filter(r => r.stops.length > 0);

          // 去重：stops 集合完全相同才视为重复，保留先出现的（1日精华优先）
          // v70.4：文学巡礼线（自由选点）不参与去重——它是主题叙事路线，价值在 narrative，
          // 站点与 1日精华重叠是预期行为（黄山实测：AI 自由选的 8 站与 1日 top8 同集合被误杀）
          const seenKeys = new Set<string>();
          const dedupedRoutes: any[] = [];
          for (const r of allRoutes) {
            if (r._free) { dedupedRoutes.push(r); continue; }
            const key = [...r.stops].sort().join("|");
            if (!seenKeys.has(key)) { seenKeys.add(key); dedupedRoutes.push(r); }
          }
          routes = dedupedRoutes;
        }
        return routes;
      })(),
    ]);

    // v80：路线图校验。这里不吞掉结构问题——跨区往返、步道顺序回退、长距离徒步
    // 都写入 process_report；只有主题游允许长距离接驳（它本来就串联 60km 内独立景点）。
    let routeGraphIssueCount = 0;
    let routeDurationMinutes = 0;
    for (const route of routes) {
      const legs = buildRouteLegs(route.stops, dbLocs, routeKnowledge);
      route.legs = legs;
      routeDurationMinutes += estimateRouteDuration(legs, route.stops.length).totalMinutes;
      const issues = routeGraphIssues(route.stops, dbLocs, routeKnowledge, {
        allowLongTransfers: route.day_label === "主题游",
        dayLabel: route.day_label,
      });
      routeGraphIssueCount += issues.length;
      for (const issue of issues) warnings.push(`🧭 路线「${route.day_label}」${issue.message}`);
    }

    // 应用内容到各地点（供写库）
    for (const l of locs) {
      const cd = contentById.get(l.id) || {};
      l.layers = normalizeLayers(cd.layers);
      l.reflection = cd.reflection || ""; l.practical = cd.practical || {};
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
    await postRows("routes", routes.map(r => ({ id: r.id, tour_id: tourId, day_label: r.day_label, title: r.title, stops: r.stops, legs: r.legs || [], narrative: r.narrative, sort_order: r.sort_order })));

    // Quality report
    const report = {
      locations: locs.length,
      routes: routes.length,
      plans: plans.length, // v70.3 诊断：计划路线数 vs 实际路线数
      corePool: corePoolSize, mainScenic: mainScenicName, coreScenic: coreScenicName,
      routeKnowledge: { source: routeKnowledge.source, confidence: routeKnowledge.confidence, destination: routeKnowledge.destinationName },
      routeGraph: { checked: routes.length, issues: routeGraphIssueCount, estimatedMinutes: Math.round(routeDurationMinutes) },
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
    // v70：成功时清掉旧错误、质量报告（含全部告警）落库，审核页可见
    await setStatus(tourId, "done", null, { ...report, at: new Date().toISOString() });
    return json({ success: true, ...report });
  } catch (e: any) {
    console.error(e);
    // v70：失败原因落库——此前只返回给 pg_net 触发器（被丢弃），前端只能显示"服务器端出错"
    if (tourId) await setStatus(tourId, "error", String(e.message || e));
    return json({ error: e.message }, 500);
  }
});
