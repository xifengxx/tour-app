// 存量导览重跑（v90）
//
// 为什么需要：v88-v90 的所有修复只作用于"新生成"，而现网 12 个公开导览里
// 21 条路线含景区伞形站点、13 条是按未核实知识造出的多日/主题游、
// 28 条缺交通分段、约 31 条缺海拔剖面，还有 2 组完全重复的路线。
// 没有重跑工具，这些修复对线上内容等于没发生。
//
// ⚠️ 这个脚本会**改写生产数据**：重新处理会 deleteRows 后重建
// locations / routes / content_layers，创作者在审核页做过的未保存编辑会丢失，
// 公开导览若没过闸门还会被自动转为私有。因此：
//   1. 默认 dry-run，只读；必须显式 --apply 才会写；
//   2. --apply 前自动把当前数据导出到备份目录；
//   3. --all 需要再用 --confirm <数量> 复核范围，防止一次误操作全库；
//   4. 串行处理，每条约 1 分钟（并发会打爆高德限流与函数 worker 预算）。
//
// 用法：
//   set -a && . ./.env && set +a
//   export SERVICE_ROLE_KEY=***                    # 或 SUPABASE_JWT=<本人登录 JWT>
//   deno run --allow-net --allow-read --allow-env --allow-write scripts/reprocess-tours.ts
//   deno run ... scripts/reprocess-tours.ts --dest 丽江 --apply
//   deno run ... scripts/reprocess-tours.ts --all --apply --confirm 12

import { findDuplicateRoutes } from "../supabase/functions/process-tour/route-dedup.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL");
const TOKEN = Deno.env.get("SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  || Deno.env.get("SUPABASE_JWT");
const ANON = Deno.env.get("VITE_SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY");
if (!SUPABASE_URL) {
  console.error("缺少 SUPABASE_URL（先 `set -a && . ./.env && set +a`）");
  Deno.exit(1);
}

const args = new Set(Deno.args);
const flagValue = (name: string) => {
  const i = Deno.args.indexOf(name);
  return i >= 0 ? Deno.args[i + 1] : undefined;
};
const apply = args.has("--apply");
const onlyDest = flagValue("--dest");
const onlyTour = flagValue("--tour");
const confirm = flagValue("--confirm");
const backupDir = flagValue("--backup-dir") || "scripts/out/backup";
const timeoutSec = Number(flagValue("--timeout") || 300);
const wantAll = args.has("--all");

if (!apply) {
  console.log("模式：dry-run（只读，不改任何数据）。要真正重跑请加 --apply\n");
} else if (!TOKEN) {
  console.error("--apply 需要 SERVICE_ROLE_KEY 或 SUPABASE_JWT：anon key 受 RLS 限制无法更新他人导览。");
  Deno.exit(1);
}

const readHdr = { apikey: ANON || TOKEN || "", Authorization: `Bearer ${ANON || TOKEN || ""}` };
const writeHdr = {
  apikey: TOKEN || "",
  Authorization: `Bearer ${TOKEN || ""}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function readTours(): Promise<any[]> {
  const params = new URLSearchParams({
    select: "id,title,status,is_public,destination,created_at,process_report,locations(count),routes(count)",
    order: "created_at.desc",
  });
  // 只读浏览用 anon 即可（看不到私有导览）；真正重跑时用带权限的 token
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tours?${params}`, { headers: apply && TOKEN ? writeHdr : readHdr });
  if (!res.ok) throw new Error(`读取导览列表失败：${res.status} ${await res.text()}`);
  return res.json();
}

async function snapshot(tourId: string) {
  const pick = async (table: string) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?tour_id=eq.${tourId}`, { headers: readHdr });
    return res.ok ? res.json() : [];
  };
  const [locations, routes, contentLayers, tips] = await Promise.all([
    pick("locations"), pick("routes"), pick("content_layers"), pick("tips"),
  ]);
  return { locations, routes, contentLayers, tips };
}

async function backupTour(tour: any, data: any) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safe = String(tour.title).replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 24);
  await Deno.mkdir(backupDir, { recursive: true });
  const file = `${backupDir}/${tour.id.slice(0, 8)}-${safe}-${stamp}.json`;
  await Deno.writeTextFile(file, JSON.stringify({ tour, ...data, backedUpAt: new Date().toISOString() }, null, 2));
  return file;
}

async function trigger(tour: any) {
  // 触发器只在 status 从"非 processing"转入 processing 时开火；
  // 卡在 processing 的历史行要先退一步，否则 PATCH 成同值不会重跑。
  if (tour.status === "processing") {
    const step = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tour.id}`, {
      method: "PATCH", headers: writeHdr, body: JSON.stringify({ status: "draft" }),
    });
    if (!step.ok) throw new Error(`重置状态失败：${step.status} ${await step.text()}`);
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tour.id}`, {
    method: "PATCH", headers: writeHdr, body: JSON.stringify({ status: "processing" }),
  });
  if (!res.ok) throw new Error(`触发重跑失败：${res.status} ${await res.text()}`);
}

async function waitForStatus(tourId: string) {
  const deadline = Date.now() + timeoutSec * 1000;
  let last = "";
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5000));
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}&select=status,process_error,process_report,is_public`,
      { headers: apply && TOKEN ? writeHdr : readHdr },
    );
    if (!res.ok) continue;
    const row = (await res.json())[0];
    if (!row) continue;
    last = row.status;
    if (row.status !== "processing") return row;
    process.stdout.write(".");
  }
  return { status: "timeout", process_error: `${timeoutSec}s 内未回到终态（最后状态 ${last}）`, process_report: null, is_public: null };
}

function summarizeRow(tour: any) {
  const report = tour.process_report || {};
  const locCount = tour.locations?.[0]?.count ?? tour.locations?.length ?? 0;
  const routeCount = tour.routes?.[0]?.count ?? tour.routes?.length ?? 0;
  return {
    status: tour.status || "-",
    locCount, routeCount,
    tier: report.knowledgeTier || report.routeKnowledge?.tier || "-",
    blocking: (report.gate?.blocking || []).length,
    suppressed: (report.suppressedPlans || []).length,
    transportIssues: (report.routeGraph || {}).issues ?? null,
    public: tour.is_public ? "公开" : "私有",
  };
}

const tours = await readTours();
let targets = tours;
if (onlyTour) targets = tours.filter(t => t.id === onlyTour || t.id.startsWith(onlyTour));
else if (onlyDest) targets = tours.filter(t => String(t.destination?.name || "").includes(onlyDest));
else if (!wantAll) {
  console.log("未指定范围：默认列出前 12 条可重跑目标（dry-run 预览）。请用 --tour/--dest/--all 指定。\n");
  targets = [];
}

if (targets.length === 0 && !onlyTour && !onlyDest && !wantAll) {
  for (const tour of tours) {
    const s = summarizeRow(tour);
    console.log(`  ${tour.id.slice(0, 8)}  ${tour.title.slice(0, 20).padEnd(22)} ${s.status.padEnd(13)} ${s.public}  地点${String(s.locCount).padStart(2)} 路线${s.routeCount} 知识${s.tier.padEnd(3)} 交通问题${String(s.transportIssues ?? "-").padStart(2)} 阻断${s.blocking}`);
  }
  console.log(`\n共 ${tours.length} 条。anon key 只能看到公开导览，私有导览需用带权限的 token 才会出现在列表里。`);
  Deno.exit(0);
}

console.log(`范围：${targets.length} 条导览　模式：${apply ? "APPLY（会改写生产数据）" : "dry-run"}\n`);
for (const tour of targets) {
  const s = summarizeRow(tour);
  console.log(`  ${tour.id.slice(0, 8)}  ${tour.title.slice(0, 22).padEnd(24)} 当前 ${s.status} / ${s.public} / 地点${s.locCount} 路线${s.routeCount}`);
}

if (wantAll && apply && confirm !== String(targets.length)) {
  console.error(`\n--all --apply 需要显式复核范围：加 --confirm ${targets.length}（当前匹配 ${targets.length} 条）。已中止，未改动任何数据。`);
  Deno.exit(1);
}

if (!apply) {
  console.log("\ndry-run 结束：没有改动任何数据。确认范围后加 --apply（--all 还需 --confirm <数量>）。");
  Deno.exit(0);
}

let done = 0, failed = 0;
for (const tour of targets) {
  console.log(`\n▶ ${tour.title} (${tour.id.slice(0, 8)})`);
  try {
    const data = await snapshot(tour.id);
    const dup = findDuplicateRoutes(data.routes.map((r: any) => ({
      day_label: r.day_label, stops: r.stops || [], _free: /文学巡礼/.test(String(r.day_label || "")),
    })));
    const file = await backupTour(tour, data);
    console.log(`  备份 ${file}（地点 ${data.locations.length} / 路线 ${data.routes.length}${dup.length ? ` / 重复路线 ${dup.length} 组` : ""}）`);
    if (tour.is_public) console.log("  ⚠️ 该导览当前公开。若新结果存在阻断级问题，闸门会自动收回公开。");
    await trigger(tour);
    process.stdout.write("  等待处理");
    const result = await waitForStatus(tour.id);
    process.stdout.write("\n");
    const report = result.process_report || {};
    const gate = report.gate || {};
    console.log(`  结果 status=${result.status}${result.is_public === false && tour.is_public ? "（已收回公开）" : ""}`);
    if (result.status === "error") {
      failed++;
      console.error(`  失败原因：${result.process_error}`);
      continue;
    }
    done++;
    console.log(`  知识 ${report.knowledgeTier || "-"} ${report.knowledgeTierLabel || ""} · 地点 ${report.locations} · 路线 ${report.routes}（计划 ${report.plans}）· 交通问题 ${(report.routeGraph || {}).issues} · 阻断 ${(gate.blocking || []).length} · 自动修复 ${gate.repairs || 0}`);
    for (const sp of report.suppressedPlans || []) console.log(`    未生成 ${sp.plan}：${sp.reason}`);
    for (const b of gate.blocking || []) console.log(`    ⛔ ${b.label}：${b.message}`);
    for (const w of (report.warnings || []).filter((x: string) => x.startsWith("♻️") || x.startsWith("⚠️ 路线") || x.startsWith("🧭"))) {
      console.log(`    · ${w.slice(0, 150)}`);
    }
  } catch (e) {
    failed++;
    console.error(`  异常：${e instanceof Error ? e.message : String(e)}`);
  }
}
console.log(`\n完成 ${done} 条，失败 ${failed} 条。可用 scripts/audit-routes.ts 复跑体检确认收敛情况。`);
