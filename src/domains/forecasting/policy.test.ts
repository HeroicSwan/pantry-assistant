import { describe, expect, it } from "vitest";
import { alertFingerprint, calculateForecast, normalizeWeights } from "@/domains/forecasting/policy";

describe("deterministic forecasting policy", () => {
  it("renormalizes usable historical windows", () => expect(normalizeWeights([0.5, 0.3, 0.2], [false, true, true])).toEqual([0, 0.6, 0.4]));
  it("keeps reserved scheduled demand out of the second subtraction", () => {
    const common = { available: 20, historical: { days7: 7, days30: 30, days90: 90, operating7: 7, operating30: 30, operating90: 90 }, weights: [0.5, 0.3, 0.2] as [number, number, number], confirmedIncoming: 0, expiringBeforeUse: 0, safetyStockDays: 2, safetyStockFixed: 0, leadTimeDays: 3, horizonDays: 30, minimumHistoryDays: 7 };
    const a = calculateForecast({ ...common, scheduledReserved: 5, scheduledUnreserved: 0 });
    const b = calculateForecast({ ...common, scheduledReserved: 0, scheduledUnreserved: 5 });
    expect(a.daysOfSupply).toBe(20);
    expect(b.daysOfSupply).toBe(15);
  });
  it("reports insufficient data instead of unlimited supply", () => expect(calculateForecast({ available: 10, historical: { days7: 0, days30: 0, days90: 0, operating7: 0, operating30: 0, operating90: 0 }, weights: [0.5,0.3,0.2], scheduledReserved: 0, scheduledUnreserved: 0, confirmedIncoming: 0, expiringBeforeUse: 0, safetyStockDays: 2, safetyStockFixed: 0, leadTimeDays: 3, horizonDays: 30, minimumHistoryDays: 7 }).confidenceLevel).toBe("insufficient_data"));
  it("creates stable scoped alert fingerprints", () => expect(alertFingerprint("a","b","low_stock","c")).toBe(alertFingerprint("a","b","low_stock","c")));
});
