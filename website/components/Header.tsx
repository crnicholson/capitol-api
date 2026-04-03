"use client";

import { useState } from "react";
import StatusBadge from "./StatusBadge";
import { triggerRefresh } from "@/lib/api";

interface HeaderProps {
  activeTab: "trades" | "explorer";
  onTabChange: (tab: "trades" | "explorer") => void;
}

export default function Header({ activeTab, onTabChange }: HeaderProps) {
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await triggerRefresh();
    } finally {
      setTimeout(() => setRefreshing(false), 1500);
    }
  }

  return (
    <header className="border-b border-zinc-800 px-6 h-12 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-5">
        <div className="flex items-center gap-2">
          <span className="text-white font-semibold text-sm tracking-tight">Capitol Trades</span>
          <span className="text-zinc-700 text-xs">·</span>
          <span className="text-zinc-500 text-xs font-mono">US House PTR</span>
        </div>
        <nav className="flex gap-0.5">
          <button
            onClick={() => onTabChange("trades")}
            className={`px-3 py-1 text-xs rounded cursor-pointer ${
              activeTab === "trades" ? "bg-zinc-800 text-white" : "text-zinc-500"
            }`}
          >
            Trades
          </button>
          <button
            onClick={() => onTabChange("explorer")}
            className={`px-3 py-1 text-xs rounded cursor-pointer ${
              activeTab === "explorer" ? "bg-zinc-800 text-white" : "text-zinc-500"
            }`}
          >
            API Explorer
          </button>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <StatusBadge />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="px-3 py-1 text-xs border border-zinc-800 text-zinc-500 rounded cursor-pointer disabled:text-zinc-700 disabled:border-zinc-900 disabled:cursor-default"
        >
          {refreshing ? "Starting..." : "Fetch Data"}
        </button>
      </div>
    </header>
  );
}
