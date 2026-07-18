import { describe, expect, it } from "vitest";
import { fitAdvancedForecastModel } from "@/domains/forecasting/advanced";

describe("advanced forecasting model", () => {
  it("learns seasonal factors and causal multipliers", () => {
    const model = fitAdvancedForecastModel([
      { date: "2026-01-05", quantity: 10 },
      { date: "2026-01-12", quantity: 12 },
      { date: "2026-02-02", quantity: 20 },
      { date: "2026-02-09", quantity: 22 },
    ], [{ startsOn: "2026-02-15", endsOn: "2026-02-20", demandMultiplier: 2 }]);
    expect(model.modelVersion).toBe("v2-hybrid-seasonal-causal");
    expect(model.sampleCount).toBe(4);
    expect(model.predict(new Date("2026-02-16T00:00:00Z"))).toBeGreaterThan(model.baselineDailyDemand);
  });

  it("returns a safe zero-demand model for empty history", () => {
    const model = fitAdvancedForecastModel([]);
    expect(model.predictedDailyDemand).toBe(0);
    expect(model.confidenceScore).toBe(0);
  });
});
