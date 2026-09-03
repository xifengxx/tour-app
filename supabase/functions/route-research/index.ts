import { GAODE_KEY, hdr, SR_KEY, SUPABASE_URL } from "../process-tour/config.ts";
import { cors, json } from "../process-tour/http.ts";
import { researchRouteKnowledge } from "./research.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors() });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (!SUPABASE_URL || !SR_KEY) return json({ error: "Supabase 服务配置缺失" }, 503);
    const secret = Deno.env.get("ROUTE_RESEARCH_SECRET");
    if (secret && req.headers.get("Authorization") !== `Bearer ${secret}`) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    let { destination, region, tourId } = body || {};
    if (tourId) {
      const rows = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${encodeURIComponent(tourId)}&select=destination`, {
        headers: hdr,
      }).then(r => r.json());
      const destinationValue = Array.isArray(rows) ? rows[0]?.destination : null;
      destination = destination || destinationValue?.name;
      region = region || destinationValue?.region;
    }
    destination = String(destination || "").trim();
    if (!destination) return json({ error: "destination 或 tourId 必填" }, 400);
    if (!GAODE_KEY) return json({ error: "GAODE_KEY 未配置" }, 503);

    const research = await researchRouteKnowledge(destination, String(region || ""));
    const { confidence, ...model } = research;
    // 自动研究只能补冷启动知识，不能覆盖人工策展或更高置信的数据。
    // 这个守卫是必须的：otherwise 一次自动研究可能会把精心维护的 0.90+ 步道降级成 4 站兜底线。
    const existingRows = await fetch(
      `${SUPABASE_URL}/rest/v1/destination_route_knowledge?destination_name=eq.${encodeURIComponent(model.destination_name)}&select=destination_name,source,confidence`,
      { headers: hdr },
    ).then(r => r.json()).catch(() => []);
    const existing = Array.isArray(existingRows) ? existingRows[0] : null;
    if (existing && (existing.source === "curated" || Number(existing.confidence) > confidence)) {
      return json({
        success: true,
        skipped: true,
        destination: model.destination_name,
        reason: "existing-knowledge-is-stronger",
        existing: { source: existing.source, confidence: Number(existing.confidence) },
      });
    }
    const payload = {
      destination_name: model.destination_name,
      aliases: model.aliases,
      model,
      source: "auto-research",
      confidence,
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/destination_route_knowledge`, {
      method: "POST",
      headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`写路线知识失败：${res.status} ${await res.text()}`);
    return json({
      success: true,
      destination: model.destination_name,
      confidence,
      trails: model.trails.length,
      stops: model.trails.reduce((sum, t) => sum + t.stops.length, 0),
      evidence: research.evidence.map(e => ({ provider: e.provider, title: e.title, url: e.url })),
    });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
