import { describe, expect, test } from 'bun:test';
import { decryptSecret, encryptSecret, publicSettings } from '../src/lib/crypto';
import { aggregateDashboard, previousWindow } from '../src/lib/dashboard';
import { errorCode } from '../src/lib/http';
import {
  REQUIRED_HEADERS,
  fetchGoogleSheet,
  parseSheet,
  parseSpreadsheetId,
} from '../src/lib/sheets';

const header = [...REQUIRED_HEADERS];
const row = (overrides: Record<string, string> = {}) => header.map((name) => ({
  'מזהה שורה': 'R1727', 'תאריך': '05/07/2026', 'שם קמפיין': 'קיץ', 'ערוץ פרסום': 'Google',
  'תקציב': '', 'סכום שהוצא בפועל': ' ₪ 1,000 ', 'חשיפות': '10,000', 'קליקים': '300',
  'לידים': '20', 'פגישות': '8', 'עסקאות': '4', 'הכנסות': '₪ 8,000', 'איש מכירות': '',
  'אזור': 'מרכז', 'מוצר או שירות': 'ייעוץ', ...overrides,
}[name] ?? ''));

describe('Google Sheet contract', () => {
  test('parses the 15 headers, keeps R1727 and distinguishes blank numbers from zero', () => {
    const result = parseSheet([header, row(), row({ 'מזהה שורה': 'R2', 'תקציב': '0' })]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.id).toBe('R1727');
    expect(result.rows[0]?.budget).toBeNull();
    expect(result.rows[1]?.budget).toBe(0);
    expect(result.rows[0]?.salesperson).toBe('לא צוין');
    expect(result.warnings).toContain('BLANK_NUMERIC_VALUES');
  });

  test('skips invalid dates and duplicate or missing IDs', () => {
    const result = parseSheet([header, row(), row(), row({ 'מזהה שורה': '' }), row({ 'מזהה שורה': 'R3', 'תאריך': '31/02/2026' })]);
    expect(result.rows).toHaveLength(1);
    expect(result.skippedRows).toBe(3);
  });

  test('accepts raw IDs and native Sheets URLs but rejects Office URLs', () => {
    expect(parseSpreadsheetId('abc_123-XYZ')).toBe('abc_123-XYZ');
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/abc_123-XYZ/edit#gid=0')).toBe('abc_123-XYZ');
    expect(() => parseSpreadsheetId('https://docs.google.com/spreadsheets/d/e/2PAC/export?format=xlsx')).toThrow();
  });

  test('reports an uploaded Office workbook instead of blaming the API key', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: {
        code: 400,
        status: 'FAILED_PRECONDITION',
        message: 'This operation is not supported for this document. The document must not be an Office file.',
      },
    }), { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

    try {
      let thrown: unknown;
      try {
        await fetchGoogleSheet('AIza-test', 'office-file-id', 'נתונים');
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: 'OFFICE_FILE_UNSUPPORTED' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('dashboard calculations', () => {
  test('calculates sheet-derived KPIs and applies AND-across filters', () => {
    const parsed = parseSheet([header, row(), row({ 'מזהה שורה': 'R2', 'שם קמפיין': 'חורף', 'הכנסות': '2000', 'עסקאות': '0' })]);
    const data = aggregateDashboard(parsed.rows, { campaigns: ['קיץ'], channels: ['Google'] });
    expect(data.kpis.revenue.current).toBe(8000);
    expect(data.kpis.actualSpend.current).toBe(1000);
    expect(data.kpis.roas.current).toBe(8);
    expect(data.kpis.roi.current).toBe(7);
    expect(data.kpis.conversionRate.current).toBe(0.2);
    expect(data.kpis.costPerDeal.current).toBe(250);
    expect(data.leaders.topCampaign).toEqual({ name: 'קיץ', revenue: 8000 });
    expect(data.leaders.topChannel).toEqual({ name: 'Google', revenue: 8000 });
  });

  test('uses null for zero denominators and computes an equal preceding window', () => {
    const parsed = parseSheet([header, row({ 'לידים': '0', 'עסקאות': '0', 'סכום שהוצא בפועל': '0' })]);
    const data = aggregateDashboard(parsed.rows, {});
    expect(data.kpis.roas.current).toBeNull();
    expect(data.kpis.roi.current).toBeNull();
    expect(data.kpis.conversionRate.current).toBeNull();
    expect(data.kpis.costPerDeal.current).toBeNull();
    expect(previousWindow('2026-07-05', '2026-07-07')).toEqual({ from: '2026-07-02', to: '2026-07-04' });
  });

  test('builds every required chart from filtered rows', () => {
    const parsed = parseSheet([
      header,
      row(),
      row({
        'מזהה שורה': 'R2',
        'שם קמפיין': 'חורף',
        'ערוץ פרסום': 'Meta',
        'לידים': '10',
        'עסקאות': '1',
        'הכנסות': '3000',
        'מוצר או שירות': 'הדרכה',
      }),
    ]);
    const data = aggregateDashboard(parsed.rows, {});

    expect(data.charts.channelLeads).toEqual([
      { name: 'Google', value: 20 },
      { name: 'Meta', value: 10 },
    ]);
    expect(data.charts.campaignConversion).toEqual([
      { name: 'קיץ', value: 0.2 },
      { name: 'חורף', value: 0.1 },
    ]);
    expect(data.charts.products).toEqual([
      { name: 'ייעוץ', value: 8000 },
      { name: 'הדרכה', value: 3000 },
    ]);
    expect(data.charts.funnel).toEqual([
      { name: 'לידים', value: 30 },
      { name: 'פגישות', value: 16 },
      { name: 'עסקאות', value: 5 },
    ]);
  });

  test('supports all six dashboard filters and exposes complete filter options', () => {
    const parsed = parseSheet([
      header,
      row(),
      row({
        'מזהה שורה': 'R2',
        'תאריך': '06/07/2026',
        'שם קמפיין': 'חורף',
        'ערוץ פרסום': 'Meta',
        'איש מכירות': 'נועה',
        'אזור': 'צפון',
        'מוצר או שירות': 'הדרכה',
      }),
    ]);
    const data = aggregateDashboard(parsed.rows, {
      from: '2026-07-06',
      to: '2026-07-06',
      campaigns: ['חורף'],
      channels: ['Meta'],
      salespeople: ['נועה'],
      regions: ['צפון'],
      products: ['הדרכה'],
    });

    expect(data.filteredRows).toBe(1);
    expect(data.filters.campaigns).toEqual(['חורף', 'קיץ']);
    expect(data.filters.channels).toEqual(['Google', 'Meta']);
    expect(data.filters.salespeople).toEqual(['לא צוין', 'נועה']);
    expect(data.filters.regions).toEqual(['מרכז', 'צפון']);
    expect(data.filters.products).toEqual(['הדרכה', 'ייעוץ']);
  });
});

describe('settings encryption', () => {
  test('round trips with user-bound AAD and rejects another user', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptSecret('AIza-secret', 'user_a', key);
    expect(decryptSecret(encrypted, 'user_a', key)).toBe('AIza-secret');
    expect(() => decryptSecret(encrypted, 'user_b', key)).toThrow();
  });

  test('public settings never expose encrypted or decrypted credentials', () => {
    const dto = publicSettings({ apiKeyEncrypted: 'cipher', apiKeyLastFour: 'cret', spreadsheetId: 'sheet', worksheetName: 'Data', status: 'CONNECTED' });
    expect(JSON.stringify(dto)).not.toContain('cipher');
    expect(JSON.stringify(dto)).not.toContain('secret');
    expect(dto.maskedApiKey).toBe('•••• •••• •••• cret');
  });
});

describe('public API errors', () => {
  test('passes documented symbolic codes and hides provider-specific codes', () => {
    expect(errorCode({ code: 'SCHEMA_MISMATCH' })).toBe('SCHEMA_MISMATCH');
    expect(errorCode({ code: '3006' })).toBe('UPSTREAM_ERROR');
    expect(errorCode(new Error('secret upstream detail'))).toBe('UPSTREAM_ERROR');
  });
});
