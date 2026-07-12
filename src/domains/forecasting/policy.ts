import { createHash } from "node:crypto";

export type ForecastInputs = {
  available: number;
  historical: { days7: number; days30: number; days90: number; operating7: number; operating30: number; operating90: number };
  weights: [number, number, number];
  scheduledReserved: number;
  scheduledUnreserved: number;
  confirmedIncoming: number;
  expiringBeforeUse: number;
  safetyStockDays: number;
  safetyStockFixed: number;
  leadTimeDays: number;
  horizonDays: number;
  minimumHistoryDays: number;
};

export function normalizeWeights(weights: number[], usable: boolean[]) {
  const selected = weights.map((weight, index) => usable[index] && weight > 0 ? weight : 0);
  const total = selected.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? selected.map((weight) => weight / total) : selected;
}

export function calculateForecast(input: ForecastInputs) {
  const averages = [input.historical.days7 / Math.max(input.historical.operating7, 1), input.historical.days30 / Math.max(input.historical.operating30, 1), input.historical.days90 / Math.max(input.historical.operating90, 1)];
  const historyDays = [input.historical.operating7, input.historical.operating30, input.historical.operating90];
  const usable = historyDays.map((days) => days > 0);
  const weights = normalizeWeights(input.weights, usable);
  const weightedDailyDemand = averages.reduce((sum, average, index) => sum + average * weights[index]!, 0);
  const safetyStock = Math.max(input.safetyStockFixed, weightedDailyDemand * input.safetyStockDays);
  const leadTimeDemand = weightedDailyDemand * input.leadTimeDays;
  const usableSupply = Math.max(input.available + input.confirmedIncoming - input.expiringBeforeUse - input.scheduledUnreserved, 0);
  const daysOfSupply = weightedDailyDemand > 0 ? usableSupply / weightedDailyDemand : null;
  const stockoutOffset = weightedDailyDemand > 0 ? Math.floor(Math.max(input.available - input.scheduledUnreserved, 0) / weightedDailyDemand) : null;
  const shortageOffset = weightedDailyDemand > 0 ? Math.floor(Math.max(input.available + input.confirmedIncoming - input.expiringBeforeUse - input.scheduledUnreserved - safetyStock, 0) / weightedDailyDemand) : null;
  const recommendedQuantity = Math.max(weightedDailyDemand * input.horizonDays + safetyStock + input.scheduledUnreserved - input.available - input.confirmedIncoming + input.expiringBeforeUse, 0);
  const observedDays = Math.max(...historyDays);
  let confidenceScore = Math.min(80, Math.round(observedDays / Math.max(input.minimumHistoryDays, 1) * 60));
  if (!usable[0]) confidenceScore -= 15;
  if (!usable[1]) confidenceScore -= 10;
  if (!usable[2]) confidenceScore -= 5;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore));
  const confidenceLevel = observedDays === 0 ? "insufficient_data" : confidenceScore >= 75 ? "high" : confidenceScore >= 50 ? "medium" : "low";
  const riskLevel = shortageOffset !== null && shortageOffset <= 3 ? "urgent" : shortageOffset !== null && shortageOffset <= 7 ? "shortage" : daysOfSupply !== null && daysOfSupply <= 14 ? "watch" : "healthy";
  return { weightedDailyDemand, safetyStock, leadTimeDemand, daysOfSupply, stockoutOffset, shortageOffset, recommendedQuantity, confidenceScore, confidenceLevel, riskLevel, normalizedWeights: weights };
}

export function forecastDate(asOf: Date, offset: number | null) {
  if (offset === null) return null;
  return new Date(asOf.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
}

export function alertFingerprint(organizationId: string, locationId: string, type: string, sourceId: string) {
  return createHash("sha256").update(`${organizationId}:${locationId}:${type}:${sourceId}`).digest("hex");
}
