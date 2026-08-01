import {
  aggregateDashboard,
  filterSheetRows,
  type DashboardFilters,
} from '../dashboard';
import type { SheetRow } from '../sheets';

type Metric = { current: number | null; previous: number | null; delta: number | null };
type Ranking = { name: string; revenue: number };
export type DimensionMetrics = {
  name: string;
  revenue: number;
  spend: number;
  leads: number;
  deals: number;
  conversionRate: number | null;
  costPerLead: number | null;
  roi: number | null;
};

export type AnalyticsSnapshot = {
  period: { from: string | null; to: string | null };
  rowCount: number;
  kpis: Record<string, Metric>;
  leaders: {
    topCampaign: { name: string; revenue: number } | null;
    topChannel: { name: string; revenue: number } | null;
  };
  rankings: {
    campaigns: Ranking[];
    channels: Ranking[];
    salespeople: Ranking[];
    products: Ranking[];
  };
  dimensions: {
    campaigns: DimensionMetrics[];
    channels: DimensionMetrics[];
    salespeople: DimensionMetrics[];
    products: DimensionMetrics[];
  };
  channelLeads: Array<{ name: string; value: number }>;
  campaignConversion: Array<{ name: string; value: number }>;
  funnel: Array<{ name: string; value: number }>;
  daily: Array<{ name: string; value: number; actualSpend: number }>;
  monthly: Array<{
    month: string;
    revenue: number;
    spend: number;
    leads: number;
    deals: number;
    conversionRate: number | null;
    roi: number | null;
  }>;
};

export type Evidence = {
  key: string;
  label: string;
  value: string | number | null;
  detail?: number;
  format: 'currency' | 'number' | 'percent' | 'text' | 'text-currency';
};

const ratio = (numerator: number, denominator: number) => denominator === 0
  ? null
  : numerator / denominator;

const ranking = (items: Array<{ name: string; value: number }> = []): Ranking[] => items
  .filter((item) => item.name !== 'אחר')
  .map((item) => ({ name: item.name, revenue: item.value }));

const dimensionMetrics = (rows: SheetRow[], key: keyof SheetRow) => Object.values(
  rows.reduce<Record<string, {
    name: string;
    revenue: number;
    spend: number;
    leads: number;
    deals: number;
  }>>((result, row) => {
    const name = String(row[key]);
    const item = result[name] ??= {
      name,
      revenue: 0,
      spend: 0,
      leads: 0,
      deals: 0,
    };
    item.revenue += row.revenue ?? 0;
    item.spend += row.actualSpend ?? 0;
    item.leads += row.leads ?? 0;
    item.deals += row.deals ?? 0;
    return result;
  }, {}),
).map((item): DimensionMetrics => ({
  ...item,
  conversionRate: ratio(item.deals, item.leads),
  costPerLead: ratio(item.spend, item.leads),
  roi: ratio(item.revenue - item.spend, item.spend),
})).sort((a, b) => b.revenue - a.revenue);

export function buildAnalyticsSnapshot(
  allRows: SheetRow[],
  filters: DashboardFilters,
): AnalyticsSnapshot {
  const dashboard = aggregateDashboard(allRows, filters);
  const selectedRows = filterSheetRows(allRows, dashboard.appliedFilters);
  const monthly = Object.values(selectedRows.reduce<Record<string, {
    month: string;
    revenue: number;
    spend: number;
    leads: number;
    deals: number;
  }>>((result, row) => {
    const month = row.date.slice(0, 7);
    const item = result[month] ??= {
      month,
      revenue: 0,
      spend: 0,
      leads: 0,
      deals: 0,
    };
    item.revenue += row.revenue ?? 0;
    item.spend += row.actualSpend ?? 0;
    item.leads += row.leads ?? 0;
    item.deals += row.deals ?? 0;
    return result;
  }, {})).sort((a, b) => a.month.localeCompare(b.month)).map((item) => ({
    ...item,
    conversionRate: ratio(item.deals, item.leads),
    roi: ratio(item.revenue - item.spend, item.spend),
  }));

  return {
    period: {
      from: dashboard.appliedFilters.from ?? null,
      to: dashboard.appliedFilters.to ?? null,
    },
    rowCount: selectedRows.length,
    kpis: dashboard.kpis,
    leaders: dashboard.leaders,
    rankings: {
      campaigns: ranking(dashboard.charts.campaigns),
      channels: ranking(dashboard.charts.channels),
      salespeople: ranking(dashboard.charts.salespeople),
      products: ranking(dashboard.charts.products),
    },
    dimensions: {
      campaigns: dimensionMetrics(selectedRows, 'campaign'),
      channels: dimensionMetrics(selectedRows, 'channel'),
      salespeople: dimensionMetrics(selectedRows, 'salesperson'),
      products: dimensionMetrics(selectedRows, 'product'),
    },
    channelLeads: dashboard.charts.channelLeads,
    campaignConversion: dashboard.charts.campaignConversion,
    funnel: dashboard.charts.funnel,
    daily: dashboard.charts.trend,
    monthly,
  };
}

export function evidenceCatalog(snapshot: AnalyticsSnapshot): Evidence[] {
  const metricDefinitions: Array<[string, string, Evidence['format']]> = [
    ['revenue', 'סך הכנסות בתקופה', 'currency'],
    ['actualSpend', 'סך הוצאות בתקופה', 'currency'],
    ['leads', 'מספר לידים בתקופה', 'number'],
    ['deals', 'מספר עסקאות בתקופה', 'number'],
    ['conversionRate', 'שיעור המרה מליד לעסקה', 'percent'],
    ['costPerLead', 'עלות ממוצעת לליד', 'currency'],
    ['costPerDeal', 'עלות ממוצעת לעסקה', 'currency'],
    ['roi', 'החזר על ההשקעה', 'percent'],
  ];
  const evidence: Evidence[] = metricDefinitions.flatMap(([key, label, format]): Evidence[] => {
    const metric = snapshot.kpis[key];
    if (!metric) return [];
    return [
      { key: `kpi.${key}.current`, label, value: metric.current, format },
      {
        key: `kpi.${key}.delta`,
        label: `${label} לעומת התקופה הקודמת`,
        value: metric.delta,
        format: 'percent' as const,
      },
    ];
  });

  if (snapshot.leaders.topCampaign) {
    evidence.push({
      key: 'leader.campaign',
      label: 'הקמפיין המוביל לפי הכנסות',
      value: snapshot.leaders.topCampaign.name,
      detail: snapshot.leaders.topCampaign.revenue,
      format: 'text-currency',
    });
  }
  if (snapshot.leaders.topChannel) {
    evidence.push({
      key: 'leader.channel',
      label: 'ערוץ הפרסום המוביל לפי הכנסות',
      value: snapshot.leaders.topChannel.name,
      detail: snapshot.leaders.topChannel.revenue,
      format: 'text-currency',
    });
  }

  const monthlyMetrics: Array<[
    keyof AnalyticsSnapshot['monthly'][number],
    string,
    Evidence['format'],
  ]> = [
    ['revenue', 'הכנסות', 'currency'],
    ['spend', 'הוצאות', 'currency'],
    ['leads', 'לידים', 'number'],
    ['deals', 'עסקאות', 'number'],
    ['conversionRate', 'שיעור המרה', 'percent'],
    ['roi', 'ROI', 'percent'],
  ];
  for (const month of snapshot.monthly) {
    for (const [metric, label, format] of monthlyMetrics) {
      evidence.push({
        key: `monthly.${month.month}.${metric}`,
        label: `${label} בחודש ${month.month}`,
        value: month[metric] as number | null,
        format,
      });
    }
  }

  const dimensionLabels: Record<keyof AnalyticsSnapshot['dimensions'], string> = {
    campaigns: 'קמפיין',
    channels: 'ערוץ',
    salespeople: 'איש מכירות',
    products: 'מוצר או שירות',
  };
  const dimensionMetrics: Array<[
    keyof DimensionMetrics,
    string,
    Evidence['format'],
  ]> = [
    ['revenue', 'הכנסות', 'currency'],
    ['spend', 'הוצאות', 'currency'],
    ['leads', 'לידים', 'number'],
    ['deals', 'עסקאות', 'number'],
    ['conversionRate', 'שיעור המרה', 'percent'],
    ['costPerLead', 'עלות לליד', 'currency'],
    ['roi', 'ROI', 'percent'],
  ];
  for (const [dimension, items] of Object.entries(snapshot.dimensions) as Array<[
    keyof AnalyticsSnapshot['dimensions'],
    DimensionMetrics[],
  ]>) {
    items.slice(0, 10).forEach((item, index) => {
      for (const [metric, label, format] of dimensionMetrics) {
        evidence.push({
          key: `dimension.${dimension}.${index}.${metric}`,
          label: `${label} · ${item.name}`,
          value: item[metric] as number | null,
          format,
        });
      }
      evidence.push({
        key: `dimension.${dimension}.${index}.name`,
        label: dimensionLabels[dimension],
        value: item.name,
        format: 'text',
      });
    });
  }

  return evidence;
}

const metricExtremeIndex = (
  items: DimensionMetrics[],
  metric: 'roi' | 'costPerLead',
  direction: 'min' | 'max',
) => items.reduce<number | null>((selectedIndex, item, index) => {
  const value = item[metric];
  if (value === null) return selectedIndex;
  if (selectedIndex === null) return index;
  const selectedValue = items[selectedIndex]?.[metric];
  if (selectedValue === null || selectedValue === undefined) return index;
  return direction === 'max'
    ? value > selectedValue ? index : selectedIndex
    : value < selectedValue ? index : selectedIndex;
}, null);

export function insightEvidenceCatalog(snapshot: AnalyticsSnapshot): Evidence[] {
  const selectedPrefixes = new Set<string>();
  for (const [dimension, items] of Object.entries(snapshot.dimensions) as Array<[
    keyof AnalyticsSnapshot['dimensions'],
    DimensionMetrics[],
  ]>) {
    const indexes = new Set([
      items.length > 0 ? 0 : null,
      metricExtremeIndex(items, 'roi', 'max'),
      metricExtremeIndex(items, 'roi', 'min'),
      metricExtremeIndex(items, 'costPerLead', 'max'),
    ].filter((index): index is number => index !== null));
    indexes.forEach((index) => {
      selectedPrefixes.add(`dimension.${dimension}.${index}.`);
    });
  }

  return evidenceCatalog(snapshot).filter((item) => (
    !item.key.startsWith('dimension.')
    || [...selectedPrefixes].some((prefix) => item.key.startsWith(prefix))
  ));
}

export function evidenceForKeys(snapshot: AnalyticsSnapshot, keys: string[]) {
  const requested = new Set(keys);
  return evidenceCatalog(snapshot).filter((item) => requested.has(item.key));
}
