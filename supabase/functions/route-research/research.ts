import { deepseek } from "../process-tour/ai.ts";
import { gaode } from "../process-tour/gaode-search.ts";
import { gaodeAroundScenics, JUNK_RE } from "../process-tour/gaode-scan.ts";

export type RouteEvidence = {
  provider: string;
  title: string;
  text: string;
  url?: string;
};

export type GeoPoint = { lng: number; lat: number; name?: string };

export type ResearchResult = {
  destination_name: string;
  aliases: string[];
  zones: { id: string; name: string; aliases?: string[] }[];
  trails: {
    id: string;
    aliases: string[];
    scenicName?: string;
    zoneId?: string;
    stops: { name: string; aliases?: string[]; lat?: number; lng?: number; required?: boolean }[];
    notes?: string;
    evidence?: string[];
  }[];
  edges: { from: string; to: string; mode: "walk" | "cableway" | "shuttle" | "car" | "other"; duration?: string; note?: string }[];
  confidence: number;
};

const UA = "tour-app-route-research/1.0 (contact: local)";
const wikiHost = new URL("https://zh.wikipedia.org/w/api.php").host;

async function wikiPages(query: string, limit = 2) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "extracts",
    explaintext: "1",
    exlimit: String(limit),
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(limit),
    gsrnamespace: "0",
  });
  const res = await fetch(`https://${wikiHost}/w/api.php?${params}`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return Object.values<any>(data?.query?.pages || {})
    .sort((a, b) => (a.index || 99) - (b.index || 99))
    .slice(0, limit);
}

export async function wikipediaEvidence(destination: string): Promise<RouteEvidence[]> {
  if (!destination) return [];
  const queries = [destination, `${destination} 景区 游览路线`];
  const results = await Promise.all(queries.map(q => wikiPages(q, 3).catch(() => [])));
  const seen = new Set<string>();
  const out: RouteEvidence[] = [];
  const pages = results.flat().sort((a, b) => {
    const exact = (title: string) => (title === destination ? 3 : title.includes(destination) || destination.includes(title) ? 2 : 0);
    return exact(String(b?.title || "")) - exact(String(a?.title || "")) || (a.index || 99) - (b.index || 99);
  });
  for (const page of pages) {
    const title = String(page?.title || "");
    const text = String(page?.extract || "").slice(0, 5000);
    if (!title || text.length < 120 || seen.has(title)) continue;
    seen.add(title);
    out.push({
      provider: "wikipedia",
      title,
      text,
      url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    });
    if (out.length >= 3) break;
  }
  return out;
}

export async function osmEvidence(center: GeoPoint, radius = 12000): Promise<RouteEvidence | null> {
  if (!center || !Number.isFinite(center.lng) || !Number.isFinite(center.lat)) return null;
  const q = `[out:json][timeout:20];(
    nwr["tourism"~"^(attraction|viewpoint)$"](around:${radius},${center.lat},${center.lng});
    nwr["historic"](around:${radius},${center.lat},${center.lng});
    nwr["natural"="peak"](around:${radius},${center.lat},${center.lng});
    nwr["amenity"="place_of_worship"](around:${radius},${center.lat},${center.lng});
  );out center 90;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
    body: new URLSearchParams({ data: q }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const rows = (data?.elements || [])
    .map((e: any) => {
      const tags = e.tags || {};
      const name = tags["name:zh"] || tags["name:zh-Hans"] || tags.name || "";
      const lng = e.lon ?? e.center?.lon;
      const lat = e.lat ?? e.center?.lat;
      if (!name || !JUNK_RE.test(name) || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      return { name: String(name), lng, lat, kind: [tags.tourism, tags.historic, tags.natural].filter(Boolean).join("/") };
    })
    .filter(Boolean)
    .sort((a: any, b: any) =>
      Math.hypot(a.lng - center.lng, a.lat - center.lat) - Math.hypot(b.lng - center.lng, b.lat - center.lat),
    );
  const dedup: any[] = [];
  for (const row of rows) {
    if (!dedup.some((d: any) => d.name === row.name || Math.hypot(d.lng - row.lng, d.lat - row.lat) < 0.0004)) dedup.push(row);
    if (dedup.length >= 70) break;
  }
  if (!dedup.length) return null;
  const text = dedup
    .map((d: any, i: number) => `${i + 1}. ${d.name} [${d.kind}] @${d.lat.toFixed(5)},${d.lng.toFixed(5)}`)
    .join("\n");
  return { provider: "openstreetmap", title: `${radius / 1000}km POI`, text };
}

export async function amapEvidence(destination: string, region: string) {
  const center = await gaode(destination, region).catch(() => null);
  if (!center) return { center: null, evidence: null as RouteEvidence | null };
  const pois = await gaodeAroundScenics(center.lng, center.lat, 15000).catch(() => []);
  const text = pois
    .slice(0, 70)
    .map((p, i) => `${i + 1}. ${p.name} @${p.lat.toFixed(5)},${p.lng.toFixed(5)}`)
    .join("\n");
  return {
    center,
    evidence: text ? { provider: "amap", title: "周边景点", text } : null,
  };
}

export async function collectRouteEvidence(destination: string, region: string) {
  const [wiki, amap] = await Promise.all([
    wikipediaEvidence(destination).catch(() => []),
    amapEvidence(destination, region || ""),
  ]);
  const osm = amap.center ? await osmEvidence(amap.center).catch(() => null) : null;
  return {
    center: amap.center,
    evidence: [...wiki, osm, amap.evidence].filter((item): item is RouteEvidence => !!item && item.text.length >= 30),
  };
}

export function buildResearchPrompt(destination: string, region: string, center: GeoPoint | null, evidence: RouteEvidence[]) {
  const evidenceText = evidence
    .map((e, i) => `【来源${i + 1}·${e.provider}】${e.title}\nURL: ${e.url || "无"}\n${e.text}`)
    .join("\n\n")
    .slice(0, 22000);
  return [
    { role: "system", content: "你是景区动线研究员。只返回JSON。不要虚构景点；不要输出无法与来源或公认地理事实对应的站点顺序。" },
    {
      role: "user",
      content: `目的地：${destination}（${region || "地区未填"}）\n中心：${center ? `${center.lat},${center.lng}` : "无"}\n\n外部证据：\n${evidenceText}\n\n请抽取真实、静态、可复用的目的地路线知识。规则：\n1. zones 用于独立徒步区/主景区；单景区可为空数组。\n2. trails 是实际游览顺序，不是地图候选点集合；必须遵循入口→山腰/核心→山顶→出口/换乘的动线。\n3. edges 写真实交通衔接（步行/索道/观光车/专车）；不要把跨区长距离车行写成徒步。\n4. 每条 trail 的 evidence 保留 1-3 条最关键来源句；没有证据的不要编造。\n5. aliases 覆盖目的地常用名；每个 trail.aliases 至少包含目的地或其景区名。\n6. confidence 最高 0.80，来源不足时降低。\n\nJSON: {"destination_name":"${destination}","aliases":[],"zones":[{"id":"","name":"","aliases":[]}],"trails":[{"id":"","aliases":[],"scenicName":"","zoneId":"","stops":[{"name":"","aliases":[],"required":true}],"notes":"","evidence":["来源句"]}],"edges":[{"from":"","to":"","mode":"walk","duration":"","note":""}],"confidence":0.0}`,
    },
  ];
}

const stopName = (value: any) => {
  const name = typeof value === "string" ? value : value?.name;
  return String(name || "").trim();
};

export function normalizeResearchResult(destination: string, raw: any, evidenceCount: number): ResearchResult | null {
  const aliases = [...new Set([destination, ...(Array.isArray(raw?.aliases) ? raw.aliases.map(String) : [])].filter(Boolean))];
  const rawZones: any[] = Array.isArray(raw?.zones) ? raw.zones : [];
  const zones = rawZones
    .map((z: any, i: number) => ({
      id: String(z?.id || `zone-${i + 1}`),
      name: String(z?.name || ""),
      aliases: Array.isArray(z?.aliases) ? z.aliases.map(String).filter(Boolean) : undefined,
    }))
    .filter((z: { name: string }) => z.name);

  const rawTrails: any[] = Array.isArray(raw?.trails) ? raw.trails : [];
  const trails = rawTrails
    .map((t: any, i: number): ResearchResult["trails"][number] | null => {
      const stops = (Array.isArray(t?.stops) ? t.stops : []).map(stopName).filter(Boolean).slice(0, 24);
      if (stops.length < 3) return null;
      const scenicName = String(t?.scenicName || "").trim();
      return {
        id: String(t?.id || `auto-${destination}-${i + 1}`),
        aliases: [...new Set([destination, scenicName, ...(Array.isArray(t?.aliases) ? t.aliases.map(String) : [])].filter(Boolean))],
        scenicName: scenicName || undefined,
        zoneId: String(t?.zoneId || "") || undefined,
        stops: stops.map((name: string) => ({ name })),
        notes: String(t?.notes || "") || undefined,
        evidence: Array.isArray(t?.evidence) ? t.evidence.map(String).filter(Boolean).slice(0, 3) : [],
      };
    })
    .filter((t): t is NonNullable<ResearchResult["trails"][number]> => !!t)
    .slice(0, 6);

  if (!trails.length) return null;
  const rawEdges: any[] = Array.isArray(raw?.edges) ? raw.edges : [];
  const edges = rawEdges
    .map((e: any) => ({
      from: String(e?.from || ""),
      to: String(e?.to || ""),
      mode: (() => {
        const rawMode = ["walk", "cableway", "shuttle", "car", "other"].includes(e?.mode) ? e.mode : "walk";
        // 模型常把“乘坐索道/观光车”的说明塞进 note，却把 mode 写成 walk。
        // 交通方式是路线图校验的关键字段，这里用原文做一次确定性纠偏。
        const text = `${rawMode} ${e?.note || ""}`;
        if (/索道|缆车/.test(text)) return "cableway";
        if (/观光车|摆渡|景区交通|接驳/.test(text)) return "shuttle";
        if (/专车|出租车|打车|大巴|汽车/.test(text)) return "car";
        return rawMode;
      })(),
      duration: String(e?.duration || "") || undefined,
      note: String(e?.note || "") || undefined,
    }))
    .filter((e: { from: string; to: string }) => e.from && e.to)
    .slice(0, 80);

  const strength = Math.min(evidenceCount, 3);
  const confidence = Math.min(0.8, 0.6 + strength * 0.05 + (trails[0].stops.length >= 5 ? 0.02 : 0));
  return {
    destination_name: String(raw?.destination_name || destination),
    aliases,
    zones,
    trails,
    edges,
    confidence,
  };
}

export async function researchRouteKnowledge(destination: string, region: string) {
  const { center, evidence } = await collectRouteEvidence(destination, region);
  const raw = await deepseek(buildResearchPrompt(destination, region, center, evidence), {
    temperature: 0.1,
    maxTokens: 4096,
    retries: 1,
  });
  const model = normalizeResearchResult(destination, raw, evidence.length);
  if (!model) throw new Error("自动路线研究未得到有效 trails");
  return { ...model, center, evidence };
}
