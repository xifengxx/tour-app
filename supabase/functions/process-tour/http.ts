import { hdr, SUPABASE_URL } from "./config.ts";

export async function setStatus(
  tourId: string,
  status: string,
  processError?: string | null,
  processReport?: any,
  extra?: Record<string, unknown>,
) {
  const body: any = { status, ...(extra || {}) };
  if (processError !== undefined) body.process_error = processError;
  if (processReport !== undefined) body.process_report = processReport;
  await fetch(`${SUPABASE_URL}/rest/v1/tours?id=eq.${tourId}`, {
    method: "PATCH",
    headers: hdr,
    body: JSON.stringify(body),
  }).catch(() => {});
}

export async function postRows(table: string, rows: any[]) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...hdr, Prefer: "return=representation,resolution=ignore-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`POST ${table}: ${res.status} ${await res.text()}`);
}


// v105：写库改成"先覆盖、再删多余"——原来的 deleteRows + postRows 会在函数被网关
// 掐断（504/546）时停在"已删未写"，整条导览的路线和地点一起消失（线上实测）。
// upsert 利用主键 id 合并，未中断前旧行一直可读；最后再删掉本轮不再存在的 id。
export async function upsertRows(table: string, rows: any[]) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...hdr, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
}

export async function deleteRowsExcept(table: string, tourId: string, keepIds: string[]) {
  const keep = keepIds.map(id => `"${id}"`).join(",");
  const q = keepIds.length
    ? `tour_id=eq.${tourId}&id=not.in.(${keep})`
    : `tour_id=eq.${tourId}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${q}`, {
    method: "DELETE",
    headers: hdr,
  });
  if (!res.ok) throw new Error(`DELETE ${table}: ${res.status} ${await res.text()}`);
}

export async function deleteRows(table: string, tourId: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?tour_id=eq.${tourId}`, {
    method: "DELETE",
    headers: hdr,
  });
  if (!res.ok) throw new Error(`DELETE ${table}: ${res.status} ${await res.text()}`);
}

export function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...cors() } });
}

export function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  } as const;
}
