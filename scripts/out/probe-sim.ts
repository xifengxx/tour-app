import { isRouteStopEligible } from "../../supabase/functions/process-tour/routes.ts";
import { JUNK_RE } from "../../supabase/functions/process-tour/gaode-scan.ts";
const ROAD_RE = /公路$|大道$|路$|街$|巷$/;
const url = Deno.env.get("VITE_SUPABASE_URL")!;
const key = Deno.env.get("SERVICE_ROLE_KEY")!;
const H = { apikey: key, Authorization: `Bearer ${key}` };
const locs = await (await fetch(`${url}/rest/v1/locations?select=name,lng,lat,importance,tags&tour_id=eq.1baca791-416e-4c72-8fed-3f59001369bf`, { headers: H })).json();
for (const l of locs) {
  const can = isRouteStopEligible(l, { destName: "黄山" });
  console.log(`${l.name} | elig=${can} junk=${JUNK_RE.test(String(l.name))} road=${ROAD_RE.test(String(l.name))} tags=${JSON.stringify(l.tags)}`);
}
