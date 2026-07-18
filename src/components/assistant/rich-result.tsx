type RichResultProps = { value: unknown };

function rowsFrom(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const candidate of Object.values(record)) {
    if (Array.isArray(candidate) && candidate.every((row) => row && typeof row === "object" && !Array.isArray(row))) return candidate as Record<string, unknown>[];
  }
  return [];
}

export function RichAssistantResult({ value }: RichResultProps) {
  const rows = rowsFrom(value);
  if (!rows.length) return <pre className="mt-4 max-h-96 overflow-auto bg-[var(--surface)] p-4 text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 12);
  const numericColumn = columns.find((column) => rows.some((row) => typeof row[column] === "number"));
  const maximum = numericColumn ? Math.max(...rows.map((row) => Number(row[numericColumn] ?? 0)), 1) : 1;
  return <div className="mt-4 grid gap-4">
    <div className="overflow-x-auto border border-[var(--rule)]"><table className="w-full min-w-[560px] text-xs"><thead className="bg-[var(--surface)]"><tr>{columns.map((column) => <th key={column} className="p-2 text-left font-semibold">{column.replaceAll("_", " ")}</th>)}</tr></thead><tbody>{rows.slice(0, 200).map((row, index) => <tr key={index} className="border-t border-[var(--rule)]">{columns.map((column) => <td key={column} className="p-2">{String(row[column] ?? "")}</td>)}</tr>)}</tbody></table></div>
    {numericColumn ? <div className="grid gap-2" aria-label={`${numericColumn} chart`}>{rows.slice(0, 20).map((row, index) => <div key={index} className="grid grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-2 text-xs"><span className="truncate">{String(row.label ?? row.name ?? row.item_name ?? index + 1)}</span><span className="h-3 bg-[var(--surface)]"><span className="block h-3 bg-[var(--ink)]" style={{ width: `${Math.max(2, (Number(row[numericColumn] ?? 0) / maximum) * 100)}%` }} /></span><span>{String(row[numericColumn] ?? "")}</span></div>)}</div> : null}
  </div>;
}
