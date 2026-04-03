"use client";

import { useEffect, useState } from "react";
import { fetchTrades } from "@/lib/api";
import type { Trade, TradesResponse, QueryParams, Person } from "@/lib/types";

interface TradesTableProps {
  params: QueryParams;
  onParamsChange: (updates: Partial<QueryParams>) => void;
}

const DEFAULT_ORDER: Record<string, "asc" | "desc"> = {
  date: "desc",
  filingdate: "desc",
  name: "asc",
  ticker: "asc",
  amount: "desc",
};

function SortArrow({ active, order }: { active: boolean; order: string }) {
  if (!active) return <span className="text-zinc-500 ml-1">↕</span>;
  return <span className="text-zinc-400 ml-1 text-xs font-light">{order === "desc" ? "↓" : "↑"}</span>;
}

function partyBadge(party: string) {
  if (party?.toLowerCase().startsWith("d"))
    return <span className="text-blue-400 font-mono text-xs">D</span>;
  if (party?.toLowerCase().startsWith("r"))
    return <span className="text-red-400 font-mono text-xs">R</span>;
  return <span className="text-zinc-500 font-mono text-xs">I</span>;
}

function categoryColor(category: string) {
  if (category === "buy") return "text-amber-400";
  if (category === "sell") return "text-red-400";
  return "text-zinc-400";
}

function formatDate(d: string) {
  if (!d) return "—";
  return d.slice(0, 10);
}

function formatPrice(price: number | null) {
  if (price == null) return null;
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PersonTooltip({ person, x, y }: { person: Person; x: number; y: number }) {
  const latestTerm = person.terms?.[person.terms.length - 1];

  return (
    <div
      className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded p-3 w-56 pointer-events-none text-xs"
      style={{ left: x, top: y + 6 }}
    >
      <p className="text-white font-medium mb-2">{person.name}</p>
      <div className="flex flex-col gap-1 text-zinc-400">
        <div className="flex justify-between">
          <span className="text-zinc-600">Party</span>
          <span>{person.party ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-zinc-600">State</span>
          <span>{person.state ?? "—"}{person.district ? ` · District ${person.district}` : ""}</span>
        </div>
        {person.birthday && (
          <div className="flex justify-between">
            <span className="text-zinc-600">Born</span>
            <span>{person.birthday}</span>
          </div>
        )}
        {person.phone && (
          <div className="flex justify-between">
            <span className="text-zinc-600">Phone</span>
            <span className="font-mono">{person.phone}</span>
          </div>
        )}
        {latestTerm && (
          <div className="flex justify-between">
            <span className="text-zinc-600">Term</span>
            <span>{latestTerm.start?.slice(0, 4)}–{latestTerm.end?.slice(0, 4) ?? "present"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TradesTable({ params, onParamsChange }: TradesTableProps) {
  const [data, setData] = useState<TradesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ person: Person; x: number; y: number } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchTrades(params)
      .then((res) => { if (active) { setData(res); setLoading(false); } })
      .catch((err) => { if (active) { setError(err.message); setLoading(false); } });
    return () => { active = false; };
  }, [
    params.person, params.ticker, params.state, params.party,
    params.category, params.type, params.from, params.to,
    params.sort, params.order, params.limit, params.offset, params.recent,
  ]);

  const currentSort = params.sort ?? "date";
  const currentOrder = params.order ?? "desc";
  const limit = parseInt(params.limit ?? "50");
  const offset = parseInt(params.offset ?? "0");
  const total = data?.total ?? 0;

  function handleSortClick(sortKey: string) {
    if (currentSort === sortKey) {
      onParamsChange({ sort: sortKey, order: currentOrder === "desc" ? "asc" : "desc", offset: "0" });
    } else {
      onParamsChange({ sort: sortKey, order: DEFAULT_ORDER[sortKey] ?? "desc", offset: "0" });
    }
  }

  function SortableHeader({ sortKey, label, className }: { sortKey: string; label: string; className?: string }) {
    return (
      <th
        className={`px-4 py-2.5 font-medium whitespace-nowrap cursor-pointer select-none text-zinc-500 ${className ?? ""}`}
        onClick={() => handleSortClick(sortKey)}
      >
        {label}
        <SortArrow active={currentSort === sortKey} order={currentOrder} />
      </th>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-red-400 text-sm font-mono">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {tooltip && <PersonTooltip person={tooltip.person} x={tooltip.x} y={tooltip.y} />}

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-zinc-800 text-left">
              <SortableHeader sortKey="date" label="Trade Date" />
              <SortableHeader sortKey="filingdate" label="Filed" />
              <SortableHeader sortKey="name" label="Person" />
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500">Pty</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500">State</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500 max-w-[160px]">Asset</th>
              <SortableHeader sortKey="ticker" label="Ticker" />
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500">Type</th>
              <SortableHeader sortKey="amount" label="Amount" />
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500">Price</th>
              <th className="px-4 py-2.5 font-medium whitespace-nowrap text-zinc-500">PDF</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-zinc-600">
                  Loading...
                </td>
              </tr>
            )}
            {!loading && data?.trades.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-zinc-600">
                  No trades found.
                </td>
              </tr>
            )}
            {!loading &&
              data?.trades.map((trade: Trade) => (
                <tr key={trade.id} className="border-b border-zinc-900">
                  <td className="px-4 py-2 text-zinc-300 font-mono whitespace-nowrap">
                    {formatDate(trade.transaction.tradeDate)}
                  </td>
                  <td className="px-4 py-2 text-zinc-600 font-mono whitespace-nowrap">
                    {formatDate(trade.transaction.filingDate)}
                  </td>
                  <td className="px-4 py-2 text-zinc-200 whitespace-nowrap">
                    {trade.person ? (
                      <span
                        className="cursor-default"
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setTooltip({ person: trade.person, x: rect.left, y: rect.bottom });
                        }}
                        onMouseLeave={() => setTooltip(null)}
                      >
                        {trade.person.name}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {partyBadge(trade.person?.party ?? "")}
                  </td>
                  <td className="px-4 py-2 text-zinc-400 font-mono whitespace-nowrap">
                    {trade.person?.state ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-300 max-w-[160px]">
                    <span className="block truncate" title={trade.asset?.name}>
                      {trade.asset?.name ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-400 font-mono whitespace-nowrap">
                    {trade.asset?.ticker ?? <span className="text-zinc-700">—</span>}
                  </td>
                  <td className={`px-4 py-2 whitespace-nowrap font-medium ${categoryColor(trade.transaction?.category)}`}>
                    {trade.transaction?.description ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-300 whitespace-nowrap">
                    {trade.transaction?.amount ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-500 font-mono whitespace-nowrap">
                    {formatPrice(trade.transaction?.price) ?? <span className="text-zinc-800">—</span>}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {trade.filing?.pdfUrl ? (
                      <a
                        href={trade.filing.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-600 text-xs font-mono"
                      >
                        PDF
                      </a>
                    ) : (
                      <span className="text-zinc-800">—</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-zinc-800 px-6 py-3 flex items-center justify-between shrink-0">
        <span className="text-xs text-zinc-600 font-mono">
          {loading
            ? "Loading..."
            : `${offset + 1}–${Math.min(offset + (data?.returned ?? 0), total)} of ${total.toLocaleString()}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => onParamsChange({ offset: String(Math.max(0, offset - limit)) })}
            disabled={offset === 0 || loading}
            className="px-3 py-1 text-xs border border-zinc-800 rounded text-zinc-400 disabled:text-zinc-700 disabled:border-zinc-900 cursor-pointer disabled:cursor-default"
          >
            Prev
          </button>
          <button
            onClick={() => onParamsChange({ offset: String(offset + limit) })}
            disabled={!data || offset + limit >= total || loading}
            className="px-3 py-1 text-xs border border-zinc-800 rounded text-zinc-400 disabled:text-zinc-700 disabled:border-zinc-900 cursor-pointer disabled:cursor-default"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
