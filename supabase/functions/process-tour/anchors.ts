import { gaodeAroundScenics, SCAN_RADIUS } from "./gaode-scan.ts";
import { FACILITY_RE } from "./gaode-search.ts";
import { haversineM } from "./geo.ts";

export const SUB_AREA_RADIUS = 12000;
export const ANCHOR_CAP = 12;
export const SUB_TOTAL_CAP = 10;
export const SUB_DEDUP_M = 300;
export const REGION_RADIUS = 60000;

export function cleanScenicName(n: string): string {
  return n.replace(/风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|森林公园|公园/g, "").replace(/[-— ]+$/, "").trim() || n;
}

function isScenicAnchor(loc: any, destName: string): boolean {
  const n = String(loc.name || "");
  if (/-/.test(n)) return false;
  const hasSuffix = /(风景名胜区|国家森林公园|风景名胜|自然保护区|风景区|景区|公园)$/.test(n);
  if (destName) {
    if (n === destName || destName.includes(n)) return true;
    if (n.includes(destName) && hasSuffix) return true;
    if (n.startsWith(destName.slice(0, 2)) && /(后山|前山|西线|东线|南线|北线|北坡|南坡|西坡|东坡)(景区|风景区)?$/.test(n)) return true;
  }
  return /(风景名胜区|国家森林公园|风景名胜|自然保护区)$/.test(n) || (/(风景区|景区|公园)$/.test(n) && !/-/.test(n));
}

function scenicWeight(n: string, destName: string): number {
  const coreBonus = destName && (n.includes(destName) || destName.includes(n)) ? 7 : 0;
  if (/风景名胜区$/.test(n)) return 6 + coreBonus;
  if (/国家森林公园$/.test(n)) return 5 + coreBonus;
  if (/风景名胜|自然保护区$/.test(n)) return 4 + coreBonus;
  if (/风景区$/.test(n)) return 3 + coreBonus;
  if (/景区$/.test(n)) return 2 + coreBonus;
  if (/公园$/.test(n)) return 1 + coreBonus;
  return coreBonus;
}

export function buildAnchors(locs: any[], destName: string): any[] {
  const cands = locs.filter(l => isScenicAnchor(l, destName)).map(l => ({ ...l, scenicName: cleanScenicName(l.name), weight: scenicWeight(l.name, destName) }));
  cands.sort((a, b) => b.weight - a.weight || b.name.length - a.name.length);
  const isCore = (c: any) => destName && (c.name.includes(destName) || destName.includes(c.name));
  const umbrella = cands.find(c => !isCore(c) && /(风景名胜区|国家森林公园)$/.test(c.name)) || null;
  const anchors: any[] = [];
  const ordered = umbrella ? [umbrella, ...cands.filter(c => c !== umbrella)] : cands;
  for (const c of ordered) {
    if (umbrella && c === umbrella) { anchors.push({ ...c, mergedNames: [], subPoints: [] }); continue; }
    const um = anchors.find(a => umbrella && a.name === umbrella.name);
    if (umbrella && um && c.weight < umbrella.weight && haversineM(umbrella, c) < 12000) {
      um.mergedNames.push(c.scenicName);
      um.subPoints.push({ lng: c.lng, lat: c.lat, name: c.scenicName });
      continue;
    }
    anchors.push({ ...c, mergedNames: [], subPoints: [] });
  }
  anchors.sort((a, b) => b.weight - a.weight);
  return anchors;
}

export async function scanAnchorSubs(anchor: any, locs: any[], otherAnchors: any[], aiKnown: Set<string>) {
  const around = await gaodeAroundScenics(anchor.lng, anchor.lat, SCAN_RADIUS);
  const existingNames = new Set(locs.map(l => String(l.name || "")));
  const out: any[] = [];
  for (const c of around) {
    const n = String(c.name || "");
    if (!n || FACILITY_RE.test(n) || n === anchor.name || n === anchor.scenicName) continue;
    if (existingNames.has(n)) continue;
    if (otherAnchors.some(a => a.id !== anchor.id && haversineM(a, c) < 5000)) continue;
    if ([...locs, ...out].some(q => haversineM(q, c) < SUB_DEDUP_M)) continue;
    const rank = aiKnown.has(n) || aiKnown.has(c.raw) ? 0 : /景区|风景|公园|名胜|自然保护区/.test(c.raw || "") ? 1 : 2;
    if (rank > 1) continue;
    out.push({ ...c, rank });
  }
  out.sort((a, b) => a.rank - b.rank);
  return out.slice(0, ANCHOR_CAP).map(c => ({ name: c.name, lat: c.lat, lng: c.lng, elevation: "", importance: 3, tags: ["子景点", `景区:${anchor.scenicName}`], scenic: anchor.scenicName }));
}

export function attachScenicTags(locs: any[], anchors: any[]) {
  for (const l of locs) {
    if (l.scenic) continue;
    const self = anchors.find(a => a.name === l.name || a.scenicName === l.name);
    if (self) { l.scenic = self.scenicName; continue; }
    let best: any = null, bestD = Infinity;
    for (const a of anchors) { const d = haversineM(a, l); if (d < bestD) { bestD = d; best = a; } }
    l.scenic = (best && bestD <= SUB_AREA_RADIUS) ? best.scenicName : "独立";
  }
  return locs;
}
