import type {
  AnalyticsSnapshot,
  DimensionMetrics,
} from './grounding';
import { evidenceCatalog } from './grounding';

export type DimensionName = keyof AnalyticsSnapshot['dimensions'];
export type DimensionMetric = Exclude<keyof DimensionMetrics, 'name'>;

export type RankDimensionInput = {
  dimension: DimensionName;
  metric: DimensionMetric;
  direction: 'best' | 'worst';
  limit: number;
};

const lowerIsBetter = new Set<DimensionMetric>(['costPerLead']);
const ratioMetrics = new Set<DimensionMetric>(['conversionRate', 'roi']);
const currencyMetrics = new Set<DimensionMetric>(['revenue', 'spend', 'costPerLead']);
const agentNumber = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 1,
});

export function formatMetricForAgent(
  metric: DimensionMetric,
  value: number | null,
) {
  if (value == null) return 'אין נתון';
  if (ratioMetrics.has(metric)) return `${agentNumber.format(value * 100)}%`;
  if (currencyMetrics.has(metric)) return `${agentNumber.format(value)} ₪`;
  return agentNumber.format(value);
}

export function rankDimension(
  snapshot: AnalyticsSnapshot,
  input: RankDimensionInput,
) {
  const ascendingForBest = lowerIsBetter.has(input.metric);
  const direction = input.direction === 'best'
    ? (ascendingForBest ? 1 : -1)
    : (ascendingForBest ? -1 : 1);
  const results = snapshot.dimensions[input.dimension]
    .filter((item) => item[input.metric] != null)
    .sort((a, b) => (
      ((a[input.metric] as number) - (b[input.metric] as number)) * direction
    ))
    .slice(0, Math.max(1, Math.min(input.limit, 10)))
    .map((item) => ({
      name: item.name,
      value: item[input.metric],
      revenue: item.revenue,
      spend: item.spend,
      leads: item.leads,
      deals: item.deals,
      conversionRate: item.conversionRate,
      costPerLead: item.costPerLead,
      roi: item.roi,
    }));

  return {
    dimension: input.dimension,
    metric: input.metric,
    direction: input.direction,
    results,
  };
}

export function rankDimensionForAgent(
  snapshot: AnalyticsSnapshot,
  input: RankDimensionInput,
) {
  const ranking = rankDimension(snapshot, input);
  return {
    ...ranking,
    results: ranking.results.map((item) => ({
      name: item.name,
      value: formatMetricForAgent(input.metric, item.value),
      revenue: formatMetricForAgent('revenue', item.revenue),
      spend: formatMetricForAgent('spend', item.spend),
      leads: formatMetricForAgent('leads', item.leads),
      deals: formatMetricForAgent('deals', item.deals),
      conversionRate: formatMetricForAgent('conversionRate', item.conversionRate),
      costPerLead: formatMetricForAgent('costPerLead', item.costPerLead),
      roi: formatMetricForAgent('roi', item.roi),
    })),
  };
}

export function evidenceForAgent(snapshot: AnalyticsSnapshot) {
  return evidenceCatalog(snapshot).map((item) => {
    let value = item.value;
    if (typeof value === 'number') {
      value = item.format === 'percent'
        ? formatMetricForAgent('roi', value)
        : item.format === 'currency'
          ? formatMetricForAgent('revenue', value)
          : formatMetricForAgent('leads', value);
    }
    return {
      ...item,
      value,
      ...(typeof item.detail === 'number'
        ? { detail: formatMetricForAgent('revenue', item.detail) }
        : {}),
    };
  });
}
