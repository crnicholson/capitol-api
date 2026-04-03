import type { TradesResponse, StatusResponse, QueryParams } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

function buildQueryString(params: QueryParams): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") query.set(k, v);
  }
  return query.toString();
}

export async function fetchTrades(params: QueryParams): Promise<TradesResponse> {
  const qs = buildQueryString(params);
  const res = await fetch(`${BASE}/api/trades${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BASE}/api/status`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function buildQueryUrl(params: QueryParams): string {
  const qs = buildQueryString(params);
  return `${BASE}/api/trades${qs ? "?" + qs : ""}`;
}

export async function triggerRefresh(): Promise<void> {
  const res = await fetch(`${BASE}/api/refresh`, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export function buildDownloadUrl(params: QueryParams): string {
  const qs = buildQueryString(params);
  return `${BASE}/api/trades/download${qs ? "?" + qs : ""}`;
}
