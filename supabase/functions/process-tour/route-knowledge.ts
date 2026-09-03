import { SR_KEY, SUPABASE_URL, hdr } from "./config.ts";
import { CURATED_TRAILS } from "./trail-routes.ts";
import { researchRouteKnowledge } from "../route-research/research.ts";
import type { DestinationRouteKnowledge, DestinationRouteKnowledgeRow, RouteEdge, RouteZone } from "./route-knowledge-types.ts";
import type { TrailRoute } from "./route-knowledge-types.ts";

const normalizeName = (value: unknown) =>
  String(value || "")
    .toLowerCase()
    .replace(/[，。、·—\-_\s（）()《》"]/g, "");

const builtinKnowledge = (destName: string): DestinationRouteKnowledge => ({
  destinationName: destName,
  aliases: [destName],
  zones: [],
  trails: CURATED_TRAILS,
  edges: [],
  source: "builtin",
  confidence: 0.5,
});

function knowledgeMatches(row: DestinationRouteKnowledgeRow, destName: string) {
  const target = normalizeName(destName);
  if (!target) return false;
  const names = [row.destination_name, ...(row.aliases || [])];
  return names.some(name => {
    const alias = normalizeName(name);
    return !!alias && (target.includes(alias) || alias.includes(target));
  });
}

export function selectRouteKnowledge(
  rows: DestinationRouteKnowledgeRow[],
  destName: string,
): DestinationRouteKnowledge {
  const hit = rows
    .filter(row => knowledgeMatches(row, destName) && Array.isArray(row.model?.trails) && row.model!.trails!.length > 0)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))[0];
  if (!hit) return builtinKnowledge(destName);
  return {
    destinationName: hit.destination_name || destName,
    aliases: hit.aliases || [],
    zones: hit.model?.zones || [],
    trails: hit.model!.trails!,
    edges: hit.model?.edges || [],
    source: hit.source || "database",
    confidence: Number(hit.confidence || 0.8),
  };
}

// v78：路线知识从“代码里的策展常量”升级为可替换数据层。数据库优先，内置数据只是兜底。
// 这是接入自动搜索前的地基：route-research 未来只需要把抓取结果 upsert 到同一张表。
export async function loadRouteKnowledge(destName: string): Promise<DestinationRouteKnowledge> {
  if (!destName || !SUPABASE_URL || !SR_KEY) return builtinKnowledge(destName);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/destination_route_knowledge?select=destination_name,aliases,model,source,confidence&order=confidence.desc`,
      { headers: hdr },
    );
    if (!res.ok) return builtinKnowledge(destName);
    const rows: DestinationRouteKnowledgeRow[] = await res.json();
    return selectRouteKnowledge(Array.isArray(rows) ? rows : [], destName);
  } catch {
    return builtinKnowledge(destName);
  }
}

export function researchedToKnowledge(research: any): DestinationRouteKnowledge {
  return {
    destinationName: research.destination_name,
    aliases: research.aliases,
    zones: research.zones || [],
    trails: research.trails || [],
    edges: research.edges || [],
    source: "auto-research",
    confidence: Number(research.confidence || 0),
  };
}

// 新山岳目的地首次生成时，先做一次外部证据研究并落库；失败时仍回退内置策展层。
// 自动研究最高 0.80，因此不会覆盖 0.90+ 的人工策展知识。
export async function loadOrResearchRouteKnowledge(destName: string, destRegion: string, destinationType?: string): Promise<DestinationRouteKnowledge> {
  const loaded = await loadRouteKnowledge(destName);
  if (loaded.source !== "builtin" || destinationType !== "mountain" || !destName) return loaded;
  try {
    const research = await researchRouteKnowledge(destName, destRegion);
    const knowledge = researchedToKnowledge(research);
    if (SUPABASE_URL && SR_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/destination_route_knowledge`, {
        method: "POST",
        headers: { ...hdr, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          destination_name: knowledge.destinationName,
          aliases: knowledge.aliases,
          model: { zones: knowledge.zones, trails: knowledge.trails, edges: knowledge.edges },
          source: knowledge.source,
          confidence: knowledge.confidence,
        }),
      });
    }
    return knowledge;
  } catch (e: any) {
    console.warn(`Route research failed for ${destName}: ${e?.message || e}`);
    return loaded;
  }
}

export type { RouteEdge, RouteZone, TrailRoute };
