"use client";

import { useState, useCallback } from "react";
import { buildQueryUrl, buildDownloadUrl } from "@/lib/api";
import type { QueryParams } from "@/lib/types";

const inputCls =
  "bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded px-2.5 py-1.5 placeholder-zinc-600 w-full focus:outline-none focus:border-zinc-600";

const selectCls =
  "bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded px-2.5 py-1.5 w-full focus:outline-none focus:border-zinc-600";

const labelCls = "text-zinc-600 text-xs mb-1 block";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

const DEFAULT_PARAMS: QueryParams = {};

export default function QueryBuilder() {
  const [params, setParams] = useState<QueryParams>({ ...DEFAULT_PARAMS, limit: "50" });
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function set(key: keyof QueryParams, value: string) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  const url = buildQueryUrl(params);
  const downloadUrl = buildDownloadUrl(params);

  async function runQuery() {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const res = await fetch(url);
      const json = await res.json();
      setResponse(JSON.stringify(json, null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  const copyUrl = useCallback(() => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [url]);

  function reset() {
    setParams(DEFAULT_PARAMS);
    setResponse(null);
    setError(null);
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <div className="w-72 shrink-0 border-r border-zinc-800 overflow-y-auto p-5 flex flex-col gap-4">
        <div>
          <p className="text-zinc-400 text-xs font-medium mb-3">Filters</p>
          <div className="flex flex-col gap-3">
            <Field label="person">
              <input className={inputCls} placeholder="Pelosi" value={params.person ?? ""} onChange={(e) => set("person", e.target.value)} />
            </Field>
            <Field label="ticker">
              <input className={inputCls} placeholder="AAPL" value={params.ticker ?? ""} onChange={(e) => set("ticker", e.target.value.toUpperCase())} />
            </Field>
            <Field label="state">
              <input className={inputCls} placeholder="CA" maxLength={2} value={params.state ?? ""} onChange={(e) => set("state", e.target.value.toUpperCase())} />
            </Field>
            <Field label="party">
              <input className={inputCls} placeholder="Democrat" value={params.party ?? ""} onChange={(e) => set("party", e.target.value)} />
            </Field>
            <Field label="type (raw)">
              <input className={inputCls} placeholder="P or S" value={params.type ?? ""} onChange={(e) => set("type", e.target.value)} />
            </Field>
            <Field label="category">
              <select className={selectCls} value={params.category ?? ""} onChange={(e) => set("category", e.target.value)}>
                <option value="">—</option>
                <option value="buy">buy</option>
                <option value="sell">sell</option>
                <option value="exchange">exchange</option>
                <option value="gift">gift</option>
                <option value="corporate_action">corporate_action</option>
                <option value="transfer">transfer</option>
                <option value="dividend">dividend</option>
                <option value="inheritance">inheritance</option>
                <option value="other">other</option>
              </select>
            </Field>
            <Field label="from (YYYY-MM-DD)">
              <input type="date" className={inputCls} value={params.from ?? ""} onChange={(e) => set("from", e.target.value)} />
            </Field>
            <Field label="to (YYYY-MM-DD)">
              <input type="date" className={inputCls} value={params.to ?? ""} onChange={(e) => set("to", e.target.value)} />
            </Field>
          </div>
        </div>

        <div>
          <p className="text-zinc-400 text-xs font-medium mb-3">Sorting & Pagination</p>
          <div className="flex flex-col gap-3">
            <Field label="sort">
              <select className={selectCls} value={params.sort ?? ""} onChange={(e) => set("sort", e.target.value)}>
                <option value="">—</option>
                <option value="newest">newest</option>
                <option value="oldest">oldest</option>
                <option value="largest">largest</option>
                <option value="name">name</option>
                <option value="ticker">ticker</option>
                <option value="filingdate">filingdate</option>
              </select>
            </Field>
            <Field label="order">
              <select className={selectCls} value={params.order ?? ""} onChange={(e) => set("order", e.target.value)}>
                <option value="">—</option>
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
            </Field>
            <Field label="limit">
              <input className={inputCls} placeholder="50" value={params.limit ?? ""} onChange={(e) => set("limit", e.target.value)} />
            </Field>
            <Field label="offset">
              <input className={inputCls} placeholder="0" value={params.offset ?? ""} onChange={(e) => set("offset", e.target.value)} />
            </Field>
            <Field label="recent (overrides sort/pagination)">
              <input className={inputCls} placeholder="25" value={params.recent ?? ""} onChange={(e) => set("recent", e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={runQuery} disabled={loading} className="flex-1 px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded cursor-pointer disabled:opacity-50 font-medium">
            {loading ? "Running..." : "Run"}
          </button>
          <button onClick={reset} className="px-3 py-1.5 text-xs border border-zinc-800 text-zinc-500 rounded cursor-pointer">
            Reset
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="border-b border-zinc-800 px-5 py-3 flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-xs font-mono shrink-0">GET</span>
            <span className="text-zinc-300 text-xs font-mono flex-1 truncate">{url}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={copyUrl} className="px-2.5 py-1 text-xs border border-zinc-800 text-zinc-500 rounded cursor-pointer shrink-0">
              {copied ? "Copied" : "Copy URL"}
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="px-2.5 py-1 text-xs border border-zinc-800 text-zinc-500 rounded shrink-0">
              Open
            </a>
            <a href={downloadUrl} className="px-2.5 py-1 text-xs border border-zinc-800 text-zinc-500 rounded shrink-0">
              Download JSON
            </a>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {!response && !error && !loading && (
            <p className="text-zinc-700 text-xs font-mono">Press Run to execute the query.</p>
          )}
          {loading && (
            <p className="text-zinc-600 text-xs font-mono">Fetching...</p>
          )}
          {error && (
            <p className="text-red-400 text-xs font-mono">Error: {error}</p>
          )}
          {response && (
            <pre className="text-zinc-300 text-xs font-mono whitespace-pre-wrap leading-5">{response}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
