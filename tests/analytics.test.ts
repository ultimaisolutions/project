import { describe, expect, test } from 'bun:test';
import {
  connectionCacheKey,
  filtersFromSearchParams,
} from '../src/lib/analytics';
import {
  buildAnalyticsSnapshot,
  evidenceForKeys,
} from '../src/lib/ai/grounding';
import {
  insightsSchema,
  validateInsightEvidence,
} from '../src/lib/ai/insights-schema';
import {
  evidenceForAgent,
  rankDimension,
  rankDimensionForAgent,
} from '../src/lib/ai/agent-tools';
import { buildManagementReport, reportToCsv } from '../src/lib/report';
import {
  buildImageFacts,
  getImageAsset,
  storeImageAsset,
} from '../src/lib/ai/image';
import { REQUIRED_HEADERS, parseSheet } from '../src/lib/sheets';
import { resolveServerEnv } from '../src/lib/env';

const header = [...REQUIRED_HEADERS];
const sheetRow = (overrides: Record<string, string> = {}) => header.map((name) => ({
  'מזהה שורה': 'R1',
  'תאריך': '05/07/2026',
  'שם קמפיין': 'קיץ',
  'ערוץ פרסום': 'Google',
  'תקציב': '1200',
  'סכום שהוצא בפועל': '1000',
  'חשיפות': '10000',
  'קליקים': '300',
  'לידים': '20',
  'פגישות': '8',
  'עסקאות': '4',
  'הכנסות': '8000',
  'איש מכירות': 'דנה',
  'אזור': 'מרכז',
  'מוצר או שירות': 'ייעוץ',
  ...overrides,
}[name] ?? ''));

describe('server environment resolution', () => {
  test('prefers Astro/Vite values and falls back to the runtime process', () => {
    expect(resolveServerEnv('vite-value', 'process-value')).toBe('vite-value');
    expect(resolveServerEnv(undefined, 'process-value')).toBe('process-value');
    expect(resolveServerEnv('', 'process-value')).toBe('process-value');
  });
});

describe('analytics request parsing', () => {
  test('parses all six filter dimensions without accepting unrelated query keys', () => {
    const query = new URLSearchParams([
      ['from', '2026-07-01'],
      ['to', '2026-07-31'],
      ['campaign', 'קיץ'],
      ['campaign', 'חורף'],
      ['channel', 'Google'],
      ['salesperson', 'דנה'],
      ['region', 'מרכז'],
      ['product', 'ייעוץ'],
      ['refresh', '1'],
      ['userId', 'attacker'],
    ]);

    expect(filtersFromSearchParams(query)).toEqual({
      from: '2026-07-01',
      to: '2026-07-31',
      campaigns: ['קיץ', 'חורף'],
      channels: ['Google'],
      salespeople: ['דנה'],
      regions: ['מרכז'],
      products: ['ייעוץ'],
    });
  });
});

describe('analytics connection cache identity', () => {
  test('ignores sync timestamps but changes when the actual Sheet connection changes', () => {
    const connection = {
      apiKeyEncrypted: 'encrypted-key-a',
      spreadsheetId: 'sheet-a',
      worksheetName: 'נתונים',
    };

    const beforeSync = connectionCacheKey('user_a', connection);
    const afterSync = connectionCacheKey('user_a', {
      ...connection,
      updatedAt: new Date('2026-08-01T10:00:00Z'),
      lastSyncAt: new Date('2026-08-01T10:00:00Z'),
    });

    expect(afterSync).toBe(beforeSync);
    expect(connectionCacheKey('user_a', {
      ...connection,
      spreadsheetId: 'sheet-b',
    })).not.toBe(beforeSync);
    expect(connectionCacheKey('user_b', connection)).not.toBe(beforeSync);
  });
});

describe('AI grounding snapshot', () => {
  test('contains deterministic sheet-derived facts and no row identifiers', () => {
    const parsed = parseSheet([
      header,
      sheetRow(),
      sheetRow({
        'מזהה שורה': 'R2',
        'תאריך': '06/07/2026',
        'שם קמפיין': 'חורף',
        'ערוץ פרסום': 'Meta',
        'לידים': '10',
        'עסקאות': '1',
        'הכנסות': '3000',
        'סכום שהוצא בפועל': '1500',
      }),
    ]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {});

    expect(snapshot.period).toEqual({ from: '2026-06-07', to: '2026-07-06' });
    expect(snapshot.rowCount).toBe(2);
    expect(snapshot.kpis.revenue.current).toBe(11000);
    expect(snapshot.kpis.roi.current).toBe(3.4);
    expect(snapshot.rankings.campaigns[0]).toEqual({ name: 'קיץ', revenue: 8000 });
    expect(snapshot.dimensions.campaigns).toEqual([
      {
        name: 'קיץ',
        revenue: 8000,
        spend: 1000,
        leads: 20,
        deals: 4,
        conversionRate: 0.2,
        costPerLead: 50,
        roi: 7,
      },
      {
        name: 'חורף',
        revenue: 3000,
        spend: 1500,
        leads: 10,
        deals: 1,
        conversionRate: 0.1,
        costPerLead: 150,
        roi: 1,
      },
    ]);
    expect(snapshot.monthly).toEqual([
      {
        month: '2026-07',
        revenue: 11000,
        spend: 2500,
        leads: 30,
        deals: 5,
        conversionRate: 1 / 6,
        roi: 3.4,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('R1');
    expect(JSON.stringify(snapshot)).not.toContain('R2');
  });

  test('resolves only evidence keys present in the deterministic catalog', () => {
    const parsed = parseSheet([header, sheetRow()]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {});
    const evidence = evidenceForKeys(snapshot, [
      'kpi.revenue.current',
      'leader.campaign',
      'fabricated.metric',
    ]);

    expect(evidence).toEqual([
      {
        key: 'kpi.revenue.current',
        label: 'סך הכנסות בתקופה',
        value: 8000,
        format: 'currency',
      },
      {
        key: 'leader.campaign',
        label: 'הקמפיין המוביל לפי הכנסות',
        value: 'קיץ',
        detail: 8000,
        format: 'text-currency',
      },
    ]);
  });

  test('exposes granular monthly and performer evidence for trends and anomalies', () => {
    const parsed = parseSheet([
      header,
      sheetRow({ 'תאריך': '15/06/2026' }),
      sheetRow({
        'מזהה שורה': 'R2',
        'תאריך': '05/07/2026',
        'שם קמפיין': 'חורף',
        'איש מכירות': 'נועה',
        'הכנסות': '3000',
        'סכום שהוצא בפועל': '1500',
      }),
    ]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {
      from: '2026-06-01',
      to: '2026-07-31',
    });
    const evidence = evidenceForKeys(snapshot, [
      'monthly.2026-06.revenue',
      'dimension.campaigns.0.roi',
      'dimension.salespeople.1.conversionRate',
    ]);

    expect(evidence).toEqual([
      {
        key: 'monthly.2026-06.revenue',
        label: 'הכנסות בחודש 2026-06',
        value: 8000,
        format: 'currency',
      },
      {
        key: 'dimension.campaigns.0.roi',
        label: 'ROI · קיץ',
        value: 7,
        format: 'percent',
      },
      {
        key: 'dimension.salespeople.1.conversionRate',
        label: 'שיעור המרה · נועה',
        value: 0.2,
        format: 'percent',
      },
    ]);
  });

  test('rejects numeric claims in model-authored narrative and unknown evidence', () => {
    const valid = {
      summary: 'הביצועים מצביעים על פער בין ההכנסות להוצאה.',
      insights: [
        { title: 'פער חיובי', explanation: 'ההכנסות גבוהות מההוצאה.', evidenceKeys: ['kpi.revenue.current'] },
        { title: 'קמפיין מוביל', explanation: 'קמפיין אחד מוביל בבירור.', evidenceKeys: ['leader.campaign'] },
        { title: 'יעילות', explanation: 'עלות הרכישה מצדיקה בדיקה.', evidenceKeys: ['kpi.costPerDeal.current'] },
      ],
      trends: [
        { title: 'מגמה', explanation: 'המגמה בתקופה חיובית.', evidenceKeys: ['kpi.revenue.delta'] },
      ],
      anomalies: [],
      exceptionalPerformers: [],
      recommendations: [
        'להעביר תקציב בהדרגה לערוץ היעיל ולמדוד את השינוי.',
        'לבחון את תהליך הסגירה בקמפיין שמביא יותר לידים.',
      ],
      investigate: ['לבדוק את איכות הלידים בקמפיין המוביל.'],
    };

    expect(insightsSchema.parse(valid)).toEqual(valid);
    expect(() => insightsSchema.parse({ ...valid, summary: 'ההכנסות עלו ב-25%.' })).toThrow();
    expect(() => validateInsightEvidence(valid, new Set([
      'kpi.revenue.current',
      'leader.campaign',
      'kpi.costPerDeal.current',
      'kpi.revenue.delta',
    ]))).not.toThrow();
    expect(() => validateInsightEvidence({
      ...valid,
      insights: [
        ...valid.insights.slice(0, 2),
        { ...valid.insights[2], evidenceKeys: ['fabricated.metric'] },
      ],
    }, new Set(['kpi.revenue.current', 'leader.campaign']))).toThrow('AI_INVALID_EVIDENCE');
  });

  test('ranks dimensions with the correct business direction and exact evidence', () => {
    const parsed = parseSheet([
      header,
      sheetRow(),
      sheetRow({
        'מזהה שורה': 'R2',
        'שם קמפיין': 'חורף',
        'ערוץ פרסום': 'Meta',
        'לידים': '10',
        'עסקאות': '1',
        'הכנסות': '3000',
        'סכום שהוצא בפועל': '1500',
      }),
    ]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {});

    expect(rankDimension(snapshot, {
      dimension: 'campaigns',
      metric: 'conversionRate',
      direction: 'best',
      limit: 1,
    }).results[0]).toMatchObject({ name: 'קיץ', value: 0.2 });
    expect(rankDimension(snapshot, {
      dimension: 'channels',
      metric: 'costPerLead',
      direction: 'best',
      limit: 1,
    }).results[0]).toMatchObject({ name: 'Google', value: 50 });
    expect(rankDimension(snapshot, {
      dimension: 'campaigns',
      metric: 'roi',
      direction: 'worst',
      limit: 1,
    }).results[0]).toMatchObject({ name: 'חורף', value: 1 });
  });

  test('normalizes ratio and currency values before exposing them to the question agent', () => {
    const snapshot = buildAnalyticsSnapshot(parseSheet([header, sheetRow()]).rows, {});
    const ranking = rankDimensionForAgent(snapshot, {
      dimension: 'campaigns',
      metric: 'roi',
      direction: 'best',
      limit: 1,
    });

    expect(ranking.results[0]).toMatchObject({
      name: 'קיץ',
      value: '700%',
      roi: '700%',
      conversionRate: '20%',
      revenue: '8,000 ₪',
      spend: '1,000 ₪',
    });
    expect(evidenceForAgent(snapshot).find((item) => item.key === 'kpi.roi.current')).toMatchObject({
      value: '700%',
      format: 'percent',
    });
  });

  test('builds a complete management report and escaped Hebrew CSV', () => {
    const parsed = parseSheet([header, sheetRow()]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {});
    const insights = insightsSchema.parse({
      summary: 'הביצועים בתקופה מצביעים על יעילות חיובית.',
      insights: [
        { title: 'הכנסות', explanation: 'ההכנסות גבוהות מההוצאה.', evidenceKeys: ['kpi.revenue.current'] },
        { title: 'קמפיין', explanation: 'הקמפיין המוביל מרכז את ההכנסות.', evidenceKeys: ['leader.campaign'] },
        { title: 'המרה', explanation: 'יחס ההמרה מצדיק המשך מעקב.', evidenceKeys: ['kpi.conversionRate.current'] },
      ],
      trends: [{ title: 'מגמה', explanation: 'המגמה בתקופה חיובית.', evidenceKeys: ['kpi.revenue.current'] }],
      anomalies: [],
      exceptionalPerformers: [],
      recommendations: ['להמשיך לעקוב אחר היעילות.', 'לבחון את איכות הלידים.'],
      investigate: ['לבדוק את תהליך הסגירה.'],
    });
    const report = buildManagementReport(snapshot, insights, 'נתונים, ראשיים');
    const csv = reportToCsv(report);

    expect(report.period).toEqual(snapshot.period);
    expect(report.charts.funnel).toHaveLength(3);
    expect(report.insights.summary).toBe(insights.summary);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"נתונים, ראשיים"');
    expect(csv).toContain('סך הכנסות');
    expect(csv).toContain('סיכום ניהולי');
  });

  test('builds image facts only from the snapshot and isolates generated assets by user', () => {
    const parsed = parseSheet([header, sheetRow()]);
    const snapshot = buildAnalyticsSnapshot(parsed.rows, {});
    const facts = buildImageFacts(snapshot, 'campaign');
    const productFacts = buildImageFacts(snapshot, 'product');
    const asset = {
      imageBase64: 'aW1hZ2U=',
      mimeType: 'image/webp' as const,
      prompt: 'A visual based on the leading campaign.',
      title: 'תמונה שיווקית',
    };
    const assetId = storeImageAsset('user_a', asset);

    expect(facts).toEqual({
      type: 'campaign',
      period: snapshot.period,
      topCampaign: { name: 'קיץ', revenue: 8000 },
      topProduct: { name: 'ייעוץ', revenue: 8000 },
      revenue: 8000,
      spend: 1000,
      leads: 20,
      deals: 4,
      roi: 7,
    });
    expect(productFacts.type).toBe('product');
    expect(productFacts.topProduct).toEqual({ name: 'ייעוץ', revenue: 8000 });
    expect(getImageAsset('user_a', assetId)).toEqual(asset);
    expect(getImageAsset('user_b', assetId)).toBeNull();
    expect(JSON.stringify(facts)).not.toContain('R1');
  });
});
