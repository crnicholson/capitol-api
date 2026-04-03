"use client";

import { useState } from "react";
import Header from "@/components/Header";
import FilterBar from "@/components/FilterBar";
import TradesTable from "@/components/TradesTable";
import QueryBuilder from "@/components/QueryBuilder";
import type { QueryParams } from "@/lib/types";

const DEFAULT_PARAMS: QueryParams = {
  sort: "date",
  order: "desc",
  limit: "50",
  offset: "0",
};

export default function Home() {
  const [activeTab, setActiveTab] = useState<"trades" | "explorer">("trades");
  const [params, setParams] = useState<QueryParams>(DEFAULT_PARAMS);

  function handleParamsChange(updates: Partial<QueryParams>) {
    setParams((prev) => ({ ...prev, ...updates }));
  }

  return (
    <div className="flex flex-col h-screen bg-[#0a0a0a] text-zinc-200">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "trades" && (
        <>
          <FilterBar params={params} onChange={setParams} />
          <TradesTable params={params} onParamsChange={handleParamsChange} />
        </>
      )}

      {activeTab === "explorer" && <QueryBuilder />}
    </div>
  );
}
