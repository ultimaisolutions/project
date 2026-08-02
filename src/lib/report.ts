import type { AnalyticsSnapshot } from './ai/grounding';
import type { InsightsOutput } from './ai/insights-schema';

const kpiLabels: Record<string, string> = {
  revenue: 'סך הכנסות',
  actualSpend: 'סך הוצאות',
  leads: 'מספר לידים',
  deals: 'מספר עסקאות',
  conversionRate: 'אחוז המרה מליד לעסקה',
  costPerLead: 'עלות ממוצעת לליד',
  costPerDeal: 'עלות ממוצעת לעסקה',
  roi: 'החזר על ההשקעה',
};

/** Combines grounded analytics and generated insights into the management report DTO. */
export function buildManagementReport(
  snapshot: AnalyticsSnapshot,
  insights: InsightsOutput,
  sourceName: string,
) {
  return {
    sourceName,
    period: snapshot.period,
    rowCount: snapshot.rowCount,
    kpis: Object.fromEntries(
      Object.entries(snapshot.kpis)
        .filter(([key]) => key in kpiLabels)
        .map(([key, metric]) => [key, {
          label: kpiLabels[key],
          ...metric,
        }]),
    ),
    leaders: snapshot.leaders,
    insights,
    charts: {
      trend: snapshot.daily,
      channelLeads: snapshot.channelLeads,
      campaignConversion: snapshot.campaignConversion,
      salespeople: snapshot.rankings.salespeople.map((item) => ({
        name: item.name,
        value: item.revenue,
      })),
      products: snapshot.rankings.products.map((item) => ({
        name: item.name,
        value: item.revenue,
      })),
      funnel: snapshot.funnel,
    },
  };
}

export type ManagementReport = ReturnType<typeof buildManagementReport>;

/** Escapes a value as one RFC 4180-style CSV cell. */
const csvCell = (value: unknown) => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Serializes a management report as UTF-8 BOM-prefixed CSV with CRLF rows. */
export function reportToCsv(report: ManagementReport) {
  const rows: unknown[][] = [
    ['דוח ניהולי STSICONIC'],
    ['מקור נתונים', report.sourceName],
    ['מתאריך', report.period.from],
    ['עד תאריך', report.period.to],
    ['מספר שורות', report.rowCount],
    [],
    ['מדד', 'ערך נוכחי', 'תקופה קודמת', 'שינוי'],
    ...Object.values(report.kpis).map((metric) => [
      metric.label,
      metric.current,
      metric.previous,
      metric.delta,
    ]),
    [],
    ['קמפיין מוביל', report.leaders.topCampaign?.name, report.leaders.topCampaign?.revenue],
    ['ערוץ מוביל', report.leaders.topChannel?.name, report.leaders.topChannel?.revenue],
    [],
    ['סיכום ניהולי', report.insights.summary],
    [],
    ['תובנות מרכזיות'],
    ...report.insights.insights.map((item) => [item.title, item.explanation]),
    [],
    ['מגמות'],
    ...report.insights.trends.map((item) => [item.title, item.explanation]),
    [],
    ['חריגות'],
    ...report.insights.anomalies.map((item) => [item.title, item.explanation]),
    [],
    ['המלצות'],
    ...report.insights.recommendations.map((item) => [item]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}
