import { readFileSync } from "fs";
const data = JSON.parse(readFileSync("scripts/taishan-data.json", "utf8"));
const TOKEN = process.env.SUPABASE_PAT;
const URL = "https://api.supabase.com/v1/projects/qxunedraoviaonjdanag/database/query";

async function query(sql) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) { console.error("ERR:", (await r.text()).substring(0, 200)); }
  return r;
}

function esc(s) {
  // Escape single quotes for PostgreSQL string literal
  return s.replace(/'/g, "''");
}

async function main() {
  const T = data.TOUR;
  console.log("Deleting old data...");
  await query("DELETE FROM locations WHERE tour_id = '" + T + "'");
  await query("DELETE FROM routes WHERE tour_id = '" + T + "'");

  console.log("Inserting " + data.locs.length + " locations...");
  for (const l of data.locs) {
    const ly = JSON.stringify(l.layers);
    const pr = JSON.stringify(l.practical || {});
    const tg = "{" + l.tags.map(t => '"' + t + '"').join(",") + "}";
    const sql = [
      "INSERT INTO locations(id,tour_id,name,lat,lng,elevation,importance,tags,layers,reflection,practical,sort_order)",
      "VALUES(",
      "'" + l.id + "',",
      "'" + T + "',",
      "'" + esc(l.name) + "',",
      l.lat + ",",
      l.lng + ",",
      "'" + esc(l.elevation) + "',",
      l.importance + ",",
      "'" + tg + "',",
      "'" + esc(ly) + "',",
      "'" + esc(l.reflection) + "',",
      "'" + esc(pr) + "',",
      l.sort_order,
      ")",
    ].join(" ");
    await query(sql);
    console.log("  ok " + l.name);
  }

  console.log("Inserting " + data.routes.length + " routes...");
  for (const r of data.routes) {
    const stops = "{" + r.stops.map(s => '"' + s + '"').join(",") + "}";
    await query(
      "INSERT INTO routes(id,tour_id,day_label,title,stops,narrative,sort_order) VALUES('" +
        r.id + "','" + T + "','" + esc(r.day_label) + "','" + esc(r.title) + "','" +
        stops + "','" + esc(r.narrative) + "'," + r.sort_order + ")"
    );
    console.log("  ok " + r.title);
  }

  console.log("Done! " + data.locs.length + " locations + " + data.routes.length + " routes");
}
main().catch(e => console.error(e.message));
