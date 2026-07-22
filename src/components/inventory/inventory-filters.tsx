"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const presets = [
  { label: "All items", stock: "all" },
  { label: "Available stock", stock: "available" },
  { label: "Needs review", stock: "needs_review" },
] as const;

type SavedFilter = { name: string; query: string; stock: string };
const storageKey = "pantry-assistant:inventory-filters";
const savedFilterEvent = "pantry-assistant:inventory-filters-changed";
const emptyFilters: SavedFilter[] = [];
let cachedRawFilters: string | null = null;
let cachedFilters: SavedFilter[] = emptyFilters;

function readSavedFilters(): SavedFilter[] {
  try {
    const raw = window.localStorage.getItem(storageKey) ?? "[]";
    if (raw === cachedRawFilters) return cachedFilters;
    const parsed = JSON.parse(raw) as unknown;
    cachedRawFilters = raw;
    cachedFilters = Array.isArray(parsed) ? parsed.filter((filter): filter is SavedFilter => Boolean(filter) && typeof filter === "object" && typeof (filter as SavedFilter).name === "string" && typeof (filter as SavedFilter).query === "string" && typeof (filter as SavedFilter).stock === "string").slice(0, 8) : emptyFilters;
    return cachedFilters;
  } catch { return emptyFilters; }
}

export function InventoryFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") ?? "";
  const stock = searchParams.get("stock") ?? "all";
  const [saveName, setSaveName] = useState("");
  const savedFilters = useSyncExternalStore(
    (callback) => { window.addEventListener(savedFilterEvent, callback); return () => window.removeEventListener(savedFilterEvent, callback); },
    readSavedFilters,
    () => emptyFilters,
  );
  const apply = (nextQuery: string, nextStock: string) => {
    const parameters = new URLSearchParams();
    if (nextQuery.trim()) parameters.set("q", nextQuery.trim());
    if (nextStock !== "all") parameters.set("stock", nextStock);
    router.push(`?${parameters.toString()}`);
  };
  const persist = (next: SavedFilter[]) => {
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event(savedFilterEvent));
  };
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    persist([{ name: name.slice(0, 40), query, stock }, ...savedFilters.filter((filter) => filter.name.toLowerCase() !== name.toLowerCase())].slice(0, 8));
    setSaveName("");
  };

  return <section className="grid gap-3" aria-label="Inventory filters">
    <div className="flex flex-wrap items-center gap-2">
    <form className="flex min-w-[16rem] flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); apply(String(new FormData(event.currentTarget).get("q") ?? ""), stock); }}>
      <label className="sr-only" htmlFor="inventory-search">Search inventory</label>
      <input id="inventory-search" name="q" defaultValue={query} className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--rule)] bg-white px-3 text-sm shadow-sm" placeholder="Search item name, SKU, or PLU" />
      <button type="submit" className="min-h-11 rounded-xl border border-[var(--ink)] bg-white px-4 text-sm font-semibold">Search</button>
    </form>
    <div className="flex flex-wrap gap-2">
      {presets.map((preset) => <button key={preset.stock} type="button" onClick={() => apply(query, preset.stock)} aria-pressed={stock === preset.stock} className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${stock === preset.stock ? "border-[var(--ink)] bg-[var(--ink)] text-white" : "border-[var(--rule)] bg-white hover:bg-[var(--surface)]"}`}>{preset.label}</button>)}
    </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--rule-soft)] pt-3">
      <label className="sr-only" htmlFor="save-inventory-filter">Saved filter name</label>
      <input id="save-inventory-filter" value={saveName} onChange={(event) => setSaveName(event.target.value)} className="min-h-10 w-48 rounded-xl border border-[var(--rule)] bg-white px-3 text-sm" maxLength={40} placeholder="Save this filter as…" />
      <button type="button" onClick={saveCurrent} disabled={!saveName.trim()} className="min-h-10 rounded-xl border border-[var(--rule)] bg-white px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50">Save filter</button>
      {savedFilters.map((filter) => <span key={filter.name} className="inline-flex overflow-hidden rounded-full border border-[var(--rule)] bg-white"><button type="button" onClick={() => apply(filter.query, filter.stock)} className="min-h-10 px-3 text-sm font-semibold hover:bg-[var(--surface)]">{filter.name}</button><button type="button" onClick={() => persist(savedFilters.filter((candidate) => candidate.name !== filter.name))} aria-label={`Remove saved filter ${filter.name}`} className="min-h-10 border-l border-[var(--rule)] px-3 text-sm hover:bg-[var(--surface)]">×</button></span>)}
    </div>
  </section>;
}
