import type { SheetRow } from './sheets';

export type DashboardFilters = { from?: string; to?: string; campaigns?: string[]; channels?: string[]; salespeople?: string[]; regions?: string[]; products?: string[] };
type Kpi = { current: number | null; previous: number | null; delta: number | null };

/** Sums numeric values for a sheet field while treating blanks as zero. */
const sum = (rows: SheetRow[], key: keyof SheetRow) => rows.reduce((total, row) => total + (typeof row[key] === 'number' ? row[key] : 0), 0);
/** Divides two values, returning `null` when the denominator is zero. */
const ratio = (a: number, b: number) => b === 0 ? null : a / b;
/** Packages current and previous values with a signed relative change. */
const kpi = (current: number | null, previous: number | null): Kpi => ({ current, previous, delta: current == null || previous == null || previous === 0 ? null : (current - previous) / Math.abs(previous) });

/** Returns the equally sized inclusive date window immediately before a given range. */
export function previousWindow(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`); const end = new Date(`${to}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const previousTo = new Date(start.getTime() - 86400000); const previousFrom = new Date(previousTo.getTime() - (days - 1) * 86400000);
  return { from: previousFrom.toISOString().slice(0, 10), to: previousTo.toISOString().slice(0, 10) };
}

/** Applies dimension filters and, unless disabled, inclusive date boundaries to rows. */
export function filterSheetRows(rows: SheetRow[], filters: DashboardFilters, includeDates = true) {
  return rows.filter((row) => (!includeDates || ((!filters.from || row.date >= filters.from) && (!filters.to || row.date <= filters.to)))
    && (!filters.campaigns?.length || filters.campaigns.includes(row.campaign))
    && (!filters.channels?.length || filters.channels.includes(row.channel))
    && (!filters.salespeople?.length || filters.salespeople.includes(row.salesperson))
    && (!filters.regions?.length || filters.regions.includes(row.region))
    && (!filters.products?.length || filters.products.includes(row.product)));
}

/** Groups rows by a dimension and sorts the summed values from highest to lowest. */
const group = (rows: SheetRow[], key: keyof SheetRow, value: keyof SheetRow = 'revenue') => Object.entries(rows.reduce<Record<string, number>>((result, row) => {
  const label = String(row[key]); result[label] = (result[label] ?? 0) + (typeof row[value] === 'number' ? row[value] : 0); return result;
}, {})).map(([name, amount]) => ({ name, value: amount })).sort((a, b) => b.value - a.value);
/** Groups numerator-to-denominator ratios by dimension, using zero for empty ratios. */
const groupRatio = (rows: SheetRow[], key: keyof SheetRow, numerator: keyof SheetRow, denominator: keyof SheetRow) => Object.entries(rows.reduce<Record<string, { numerator: number; denominator: number }>>((result, row) => {
  const label = String(row[key]);
  const item = result[label] ??= { numerator: 0, denominator: 0 };
  item.numerator += typeof row[numerator] === 'number' ? row[numerator] : 0;
  item.denominator += typeof row[denominator] === 'number' ? row[denominator] : 0;
  return result;
}, {})).map(([name, values]) => ({ name, value: ratio(values.numerator, values.denominator) ?? 0 })).sort((a, b) => b.value - a.value);
/** Keeps the highest-ranked items and combines the remainder into an "Other" bucket. */
const topWithOther=(items:{name:string;value:number}[],limit=8)=>items.length<=limit?items:[...items.slice(0,limit),{name:'אחר',value:items.slice(limit).reduce((total,item)=>total+item.value,0)}];

/**
 * Aggregates filtered sheet rows into comparison KPIs, leaders, filter options,
 * and chart-ready series for the dashboard.
 */
export function aggregateDashboard(allRows: SheetRow[], filters: DashboardFilters) {
  const dates = allRows.map((row) => row.date).sort();
  const to = filters.to ?? dates.at(-1); const from = filters.from ?? (to ? new Date(new Date(`${to}T00:00:00Z`).getTime() - 29 * 86400000).toISOString().slice(0, 10) : undefined);
  const applied = { ...filters, from, to };
  const rows = filterSheetRows(allRows, applied);
  const previousDates = from && to ? previousWindow(from, to) : {};
  const previous = filterSheetRows(allRows, { ...filters, ...previousDates });
  /** Computes the core totals and derived ratios for one comparison window. */
  const metrics = (items: SheetRow[]) => { const revenue = sum(items, 'revenue'), actualSpend = sum(items, 'actualSpend'), leads = sum(items, 'leads'), deals = sum(items, 'deals'); return { revenue, actualSpend, impressions: sum(items, 'impressions'), meetings: sum(items, 'meetings'), roas: ratio(revenue, actualSpend), roi: ratio(revenue - actualSpend, actualSpend), leads, conversionRate: ratio(deals, leads), averageDealValue: ratio(revenue, deals), costPerLead: ratio(actualSpend, leads), costPerDeal: ratio(actualSpend, deals), deals }; };
  const current = metrics(rows), prior = metrics(previous);
  const campaignsByRevenue = group(rows, 'campaign');
  const channelsByRevenue = group(rows, 'channel');
  return {
    appliedFilters: applied, filteredRows: rows.length,
    sourceBounds: dates.length ? { from: dates[0], to: dates.at(-1) } : null,
    kpis: Object.fromEntries(Object.keys(current).map((key) => [key, kpi(current[key as keyof typeof current], prior[key as keyof typeof prior])])) as Record<keyof typeof current, Kpi>,
    leaders: {
      topCampaign: campaignsByRevenue[0] ? { name: campaignsByRevenue[0].name, revenue: campaignsByRevenue[0].value } : null,
      topChannel: channelsByRevenue[0] ? { name: channelsByRevenue[0].name, revenue: channelsByRevenue[0].value } : null,
    },
    filters: { campaigns: [...new Set(allRows.map((r) => r.campaign))].sort(), channels: [...new Set(allRows.map((r) => r.channel))].sort(), salespeople: [...new Set(allRows.map((r) => r.salesperson))].sort(), regions: [...new Set(allRows.map((r) => r.region))].sort(), products: [...new Set(allRows.map((r) => r.product))].sort() },
    charts: {
      trend: Object.values(rows.reduce<Record<string,{name:string;value:number;actualSpend:number}>>((result,row)=>{const item=result[row.date]??={name:row.date,value:0,actualSpend:0};item.value+=row.revenue??0;item.actualSpend+=row.actualSpend??0;return result},{})).sort((a,b)=>a.name.localeCompare(b.name)),
      channelLeads: group(rows, 'channel', 'leads'),
      campaignConversion: groupRatio(rows, 'campaign', 'deals', 'leads'),
      salespeople: topWithOther(group(rows, 'salesperson')),
      products: topWithOther(group(rows, 'product')),
      funnel: [{ name: 'לידים', value: current.leads }, { name: 'פגישות', value: current.meetings }, { name: 'עסקאות', value: current.deals }],
      campaigns: topWithOther(campaignsByRevenue),
      channels: channelsByRevenue,
      regions: group(rows, 'region'),
    },
  };
}
