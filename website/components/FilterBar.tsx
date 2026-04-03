"use client";

import type { QueryParams } from "@/lib/types";

interface FilterBarProps {
  params: QueryParams;
  onChange: (params: QueryParams) => void;
}

const inputCls =
  "bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded px-2.5 py-1.5 placeholder-zinc-600 w-full focus:outline-none focus:border-zinc-600";

const selectCls =
  "bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs rounded px-2.5 py-1.5 w-full focus:outline-none focus:border-zinc-600";

export default function FilterBar({ params, onChange }: FilterBarProps) {
  function set(key: keyof QueryParams, value: string) {
    onChange({ ...params, [key]: value, offset: "0" });
  }

  function reset() {
    onChange({ limit: params.limit ?? "50", sort: params.sort, order: params.order, offset: "0" });
  }

  return (
    <div className="border-b border-zinc-800 px-6 py-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1 min-w-[120px]">
        <label className="text-zinc-600 text-xs">Person</label>
        <input
          className={inputCls}
          placeholder="Pelosi"
          value={params.person ?? ""}
          onChange={(e) => set("person", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[100px]">
        <label className="text-zinc-600 text-xs">Ticker</label>
        <input
          className={inputCls}
          placeholder="AAPL"
          value={params.ticker ?? ""}
          onChange={(e) => set("ticker", e.target.value.toUpperCase())}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[80px]">
        <label className="text-zinc-600 text-xs">State</label>
        <input
          className={inputCls}
          placeholder="CA"
          maxLength={2}
          value={params.state ?? ""}
          onChange={(e) => set("state", e.target.value.toUpperCase())}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[120px]">
        <label className="text-zinc-600 text-xs">Party</label>
        <select
          className={selectCls}
          value={params.party ?? ""}
          onChange={(e) => set("party", e.target.value)}
        >
          <option value="">All</option>
          <option value="Democrat">Democrat</option>
          <option value="Republican">Republican</option>
          <option value="Independent">Independent</option>
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-[120px]">
        <label className="text-zinc-600 text-xs">Category</label>
        <select
          className={selectCls}
          value={params.category ?? ""}
          onChange={(e) => set("category", e.target.value)}
        >
          <option value="">All</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
          <option value="exchange">Exchange</option>
          <option value="gift">Gift</option>
          <option value="corporate_action">Corporate Action</option>
          <option value="transfer">Transfer</option>
          <option value="dividend">Dividend</option>
          <option value="inheritance">Inheritance</option>
          <option value="other">Other</option>
        </select>
      </div>

      <div className="flex flex-col gap-1 min-w-[110px]">
        <label className="text-zinc-600 text-xs">From</label>
        <input
          type="date"
          className={inputCls}
          value={params.from ?? ""}
          onChange={(e) => set("from", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[110px]">
        <label className="text-zinc-600 text-xs">To</label>
        <input
          type="date"
          className={inputCls}
          value={params.to ?? ""}
          onChange={(e) => set("to", e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1 min-w-[80px]">
        <label className="text-zinc-600 text-xs">Limit</label>
        <select
          className={selectCls}
          value={params.limit ?? "50"}
          onChange={(e) => set("limit", e.target.value)}
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="250">250</option>
        </select>
      </div>

      <button
        onClick={reset}
        className="px-3 py-1.5 text-xs text-zinc-500 border border-zinc-800 rounded cursor-pointer self-end"
      >
        Reset
      </button>
    </div>
  );
}
