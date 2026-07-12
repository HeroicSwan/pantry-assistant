import { describe, expect, it } from "vitest";
import { createCsv, defaultDateRange, escapeCsvCell, parseReportFilters, reportDefinitions, spreadsheetSafeValue, weeklyRecommendations } from "@/domains/reports/policy";

describe("report policy", () => {
  const now = new Date("2026-07-11T16:00:00.000Z");

  it("creates deterministic current, previous, and rolling date ranges", () => {
    expect(defaultDateRange(now, "current-week")).toEqual({ dateFrom: "2026-07-06", dateTo: "2026-07-12" });
    expect(defaultDateRange(now, "previous-week")).toEqual({ dateFrom: "2026-06-29", dateTo: "2026-07-05" });
    expect(defaultDateRange(now, "last-30-days")).toEqual({ dateFrom: "2026-06-12", dateTo: "2026-07-11" });
    expect(parseReportFilters({ range: "current-week" }, now, "weekly-summary")).toMatchObject({ dateFrom: "2026-07-06", dateTo: "2026-07-12" });
    expect(parseReportFilters({ itemId: "", categoryId: "", donorId: "" }, now)).toMatchObject({ itemId: undefined, categoryId: undefined, donorId: undefined });
  });

  it("rejects inverted and unbounded custom ranges", () => {
    expect(() => parseReportFilters({ dateFrom: "2026-07-10", dateTo: "2026-07-01" }, now)).toThrow("INVALID_DATE_RANGE");
    expect(() => parseReportFilters({ dateFrom: "2025-01-01", dateTo: "2026-07-01" }, now)).toThrow("DATE_RANGE_TOO_LARGE");
  });

  it("escapes CSV syntax and neutralizes spreadsheet formulas", () => {
    for (const unsafe of ["=2+2", "+SUM(A1:A2)", "-10+20", "@cmd", "  =HYPERLINK(\"bad\")"]) {
      expect(spreadsheetSafeValue(unsafe).startsWith("'")).toBe(true);
    }
    expect(escapeCsvCell('Pantry, "North"')).toBe('"Pantry, ""North"""');
    const csv = createCsv([{ key: "name", label: "Name" }, { key: "note", label: "Note" }], [{ name: "=2+2", note: "line 1\nline 2" }]);
    expect(csv.startsWith("\uFEFFName,Note\r\n'=2+2,")).toBe(true);
    expect(csv).toContain('"line 1\nline 2"');
  });

  it("maps every report to a scoped report permission", () => {
    expect(reportDefinitions["inventory-on-hand"].permission).toBe("report.view_inventory");
    expect(reportDefinitions["donor-contributions"].permission).toBe("report.view_donations");
    expect(reportDefinitions.distributions.permission).toBe("report.view_distributions");
    expect(reportDefinitions.messaging.permission).toBe("report.view_messaging");
    expect(reportDefinitions["weekly-summary"].permission).toBe("report.weekly_summary");
  });

  it("derives rule-based weekly recommendations without AI", () => {
    expect(weeklyRecommendations({ urgentAlerts: 1, noShows: 2, failedMessages: 3, expiringQuantity: 4 })).toEqual([
      "Review and assign every open urgent alert.",
      "Prioritize expiring inventory in upcoming distributions.",
      "Review missed pickups before the next scheduling cycle.",
      "Review failed messages and invalid recipient numbers.",
    ]);
  });
});
