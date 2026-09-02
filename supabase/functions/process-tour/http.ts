import { hdr, SUPABASE_URL } from "./config.ts";

export async function setStatus(tourId: string, status: string, processError?: string | null, processReport?: any) {
  const body: any = { status };
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
