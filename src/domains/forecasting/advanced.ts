export type ForecastObservation = { date: string | Date; quantity: number };

export type CausalEvent = {
  startsOn: string;
  endsOn: string;
  demandMultiplier: number;
};

export type AdvancedForecastModel = {
  modelVersion: "v2-hybrid-seasonal-causal";
  predictedDailyDemand: number;
  baselineDailyDemand: number;
  trendPerDay: number;
  weekdayFactors: number[];
  monthFactors: number[];
  activeCausalMultipliers: number[];
  confidenceScore: number;
  sampleCount: number;
  predict(date: Date, events?: CausalEvent[]): number;
};

function asDate(value: string | Date) {
  return value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function eventMultiplier(date: Date, events: CausalEvent[]) {
  const day = date.toISOString().slice(0, 10);
  return events.reduce((result, event) => day >= event.startsOn && day <= event.endsOn ? result * clamp(event.demandMultiplier, 0.1, 10) : result, 1);
}

/**
 * Lightweight local forecasting model. It combines a linear trend with learned
 * weekday/month indices and explicit causal event multipliers. It uses no hosted
 * service or model download, so it is safe for a self-hosted Windows install.
 */
export function fitAdvancedForecastModel(observations: ForecastObservation[], events: CausalEvent[] = []): AdvancedForecastModel {
  const normalized = observations
    .map((observation) => ({ date: asDate(observation.date), quantity: Number(observation.quantity) }))
    .filter((observation) => Number.isFinite(observation.quantity) && observation.quantity >= 0 && !Number.isNaN(observation.date.getTime()))
    .sort((left, right) => left.date.getTime() - right.date.getTime());
  const baseline = mean(normalized.map((observation) => observation.quantity));
  const weekdayFactors = Array.from({ length: 7 }, (_, weekday) => {
    const values = normalized.filter((observation) => observation.date.getUTCDay() === weekday).map((observation) => observation.quantity);
    return baseline > 0 && values.length ? clamp(mean(values) / baseline, 0.25, 4) : 1;
  });
  const monthFactors = Array.from({ length: 12 }, (_, month) => {
    const values = normalized.filter((observation) => observation.date.getUTCMonth() === month).map((observation) => observation.quantity);
    return baseline > 0 && values.length ? clamp(mean(values) / baseline, 0.25, 4) : 1;
  });
  const origin = normalized[0]?.date.getTime() ?? Date.now();
  const xs = normalized.map((observation) => (observation.date.getTime() - origin) / 86_400_000);
  const xMean = mean(xs);
  const yMean = mean(normalized.map((observation) => observation.quantity));
  const denominator = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const trendPerDay = denominator > 0 ? xs.reduce((sum, x, index) => sum + (x - xMean) * (normalized[index]!.quantity - yMean), 0) / denominator : 0;
  const latest = normalized.at(-1)?.date ?? new Date();
  const predictedDailyDemand = Math.max(0, (baseline + trendPerDay * ((latest.getTime() - origin) / 86_400_000)) * (weekdayFactors[latest.getUTCDay()] ?? 1) * (monthFactors[latest.getUTCMonth()] ?? 1) * eventMultiplier(latest, events));
  const confidenceScore = clamp(Math.round(Math.min(95, normalized.length * 3 + (denominator > 0 ? 20 : 0))), 0, 100);
  return {
    modelVersion: "v2-hybrid-seasonal-causal",
    predictedDailyDemand,
    baselineDailyDemand: baseline,
    trendPerDay,
    weekdayFactors,
    monthFactors,
    activeCausalMultipliers: events.map((event) => clamp(event.demandMultiplier, 0.1, 10)),
    confidenceScore,
    sampleCount: normalized.length,
    predict(date, dateEvents = events) {
      const days = (date.getTime() - origin) / 86_400_000;
      return Math.max(0, (baseline + trendPerDay * days) * (weekdayFactors[date.getUTCDay()] ?? 1) * (monthFactors[date.getUTCMonth()] ?? 1) * eventMultiplier(date, dateEvents));
    },
  };
}
