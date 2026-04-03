"use client";

import { useEffect, useState } from "react";
import { fetchStatus } from "@/lib/api";
import type { StatusResponse } from "@/lib/types";

export default function StatusBadge() {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status) {
    return <span className="text-xs text-zinc-600 font-mono">connecting...</span>;
  }

  const dot =
    status.cacheStatus === "complete"
      ? "bg-emerald-500"
      : status.cacheStatus === "in_progress"
      ? "bg-amber-400"
      : "bg-zinc-600";

  const label =
    status.cacheStatus === "complete"
      ? `${status.totalTrades.toLocaleString()} trades`
      : status.cacheStatus === "in_progress"
      ? status.fetchProgress || "fetching..."
      : "no cache";

  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-xs text-zinc-400 font-mono">{label}</span>
    </div>
  );
}
