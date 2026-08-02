export const REQUIRED_HEADERS = [
  'מזהה שורה', 'תאריך', 'שם קמפיין', 'ערוץ פרסום', 'תקציב', 'סכום שהוצא בפועל',
  'חשיפות', 'קליקים', 'לידים', 'פגישות', 'עסקאות', 'הכנסות', 'איש מכירות', 'אזור',
  'מוצר או שירות',
] as const;

export type SheetRow = {
  id: string; date: string; campaign: string; channel: string; budget: number | null;
  actualSpend: number | null; impressions: number | null; clicks: number | null;
  leads: number | null; meetings: number | null; deals: number | null; revenue: number | null;
  salesperson: string; region: string; product: string;
};

const fieldMap: Record<(typeof REQUIRED_HEADERS)[number], keyof SheetRow> = {
  'מזהה שורה': 'id', 'תאריך': 'date', 'שם קמפיין': 'campaign', 'ערוץ פרסום': 'channel',
  'תקציב': 'budget', 'סכום שהוצא בפועל': 'actualSpend', 'חשיפות': 'impressions',
  'קליקים': 'clicks', 'לידים': 'leads', 'פגישות': 'meetings', 'עסקאות': 'deals',
  'הכנסות': 'revenue', 'איש מכירות': 'salesperson', 'אזור': 'region', 'מוצר או שירות': 'product',
};

const numericFields = new Set<keyof SheetRow>(['budget', 'actualSpend', 'impressions', 'clicks', 'leads', 'meetings', 'deals', 'revenue']);
const dimensionFields = new Set<keyof SheetRow>(['campaign', 'channel', 'salesperson', 'region', 'product']);

/** Parses a strict `DD/MM/YYYY` value into an ISO date, rejecting impossible dates. */
function parseDate(value: string) {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dd, mm, yyyy] = match;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (date.getUTCFullYear() !== Number(yyyy) || date.getUTCMonth() !== Number(mm) - 1 || date.getUTCDate() !== Number(dd)) return null;
  return date.toISOString().slice(0, 10);
}

/** Parses a formatted numeric cell, preserving blank or invalid values as `null`. */
function parseNumber(value: string) {
  const clean = value.replace(/[₪$,€£\u00a0\s]/g, '').trim();
  if (!clean) return null;
  const number = Number(clean);
  return Number.isFinite(number) ? number : null;
}

/**
 * Validates the required worksheet headers and converts valid source rows into the
 * dashboard schema, skipping missing, duplicate, or invalid row identities.
 */
export function parseSheet(values: string[][]) {
  const headers = values[0] ?? [];
  const missing = REQUIRED_HEADERS.filter((name) => !headers.includes(name));
  if (missing.length) throw Object.assign(new Error('SCHEMA_MISMATCH'), { code: 'SCHEMA_MISMATCH', missing });
  const indexes = Object.fromEntries(REQUIRED_HEADERS.map((name) => [name, headers.indexOf(name)]));
  const rows: SheetRow[] = [];
  const ids = new Set<string>();
  let skippedRows = 0;
  let hasBlankNumeric = false;

  for (const cells of values.slice(1)) {
    const rawId = (cells[indexes['מזהה שורה']!] ?? '').trim();
    const date = parseDate(cells[indexes['תאריך']!] ?? '');
    if (!rawId || !date || ids.has(rawId)) { skippedRows++; continue; }
    ids.add(rawId);
    const parsed = { id: rawId, date } as SheetRow;
    for (const header of REQUIRED_HEADERS.slice(2)) {
      const key = fieldMap[header];
      const raw = cells[indexes[header]!] ?? '';
      if (numericFields.has(key)) {
        const number = parseNumber(raw);
        if (raw.trim() === '') hasBlankNumeric = true;
        (parsed as unknown as Record<string, unknown>)[key] = number;
      } else if (dimensionFields.has(key)) {
        (parsed as unknown as Record<string, unknown>)[key] = raw.trim() || 'לא צוין';
      }
    }
    rows.push(parsed);
  }
  return { rows, skippedRows, warnings: hasBlankNumeric ? ['BLANK_NUMERIC_VALUES'] : [] };
}

/** Extracts a Google spreadsheet ID from either a raw ID or a canonical Sheets URL. */
export function parseSpreadsheetId(input: string) {
  const value = input.trim();
  if (/^[\w-]{8,}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname !== 'docs.google.com') throw new Error();
    const match = url.pathname.match(/^\/spreadsheets\/d\/([\w-]+)(?:\/|$)/);
    if (!match?.[1] || match[1] === 'e') throw new Error();
    return match[1];
  } catch { throw Object.assign(new Error('INVALID_SPREADSHEET'), { code: 'INVALID_SPREADSHEET' }); }
}

/**
 * Fetches worksheet metadata and values concurrently, verifies the requested tab,
 * and parses its rows. Error precedence remains metadata-first.
 */
export async function fetchGoogleSheet(apiKey: string, spreadsheetId: string, worksheetName: string, signal?: AbortSignal) {
  const metadataUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,properties.title,sheets.properties.title&key=${encodeURIComponent(apiKey)}`;
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(worksheetName)}?majorDimension=ROWS&key=${encodeURIComponent(apiKey)}`;
  const [metadataSettled, valuesSettled] = await Promise.allSettled([
    fetch(metadataUrl, { signal }),
    fetch(valuesUrl, { signal }),
  ]);

  // An unread body leaks the connection, so discard it on every path that
  // throws before the values response is parsed.
  const discardValues = () => {
    if (valuesSettled.status === 'fulfilled') void valuesSettled.value.body?.cancel().catch(() => {});
  };

  if (metadataSettled.status === 'rejected') { discardValues(); throw metadataSettled.reason; }
  const metadataResponse = metadataSettled.value;
  if (!metadataResponse.ok) { discardValues(); throw await mapGoogleError(metadataResponse); }
  const metadata = await metadataResponse.json() as { sheets?: Array<{ properties?: { title?: string } }> };
  if (!metadata.sheets?.some((sheet) => sheet.properties?.title === worksheetName)) { discardValues(); throw Object.assign(new Error('WORKSHEET_NOT_FOUND'), { code: 'WORKSHEET_NOT_FOUND' }); }

  if (valuesSettled.status === 'rejected') throw valuesSettled.reason;
  const valuesResponse = valuesSettled.value;
  if (!valuesResponse.ok) throw await mapGoogleError(valuesResponse);
  const result = await valuesResponse.json() as { values?: string[][] };
  return parseSheet(result.values ?? []);
}

/** Maps Google API responses to the application's sanitized sheet error vocabulary. */
async function mapGoogleError(response: Response) {
  const body = await response.json().catch(() => null) as {
    error?: { status?: string; message?: string };
  } | null;
  const isOfficeWorkbook = response.status === 400
    && body?.error?.status === 'FAILED_PRECONDITION'
    && /Office file/i.test(body.error.message ?? '');
  const code = isOfficeWorkbook
    ? 'OFFICE_FILE_UNSUPPORTED'
    : response.status === 403
      ? 'PERMISSION_DENIED'
      : response.status === 404
        ? 'SPREADSHEET_NOT_FOUND'
        : response.status === 400
          ? 'INVALID_API_KEY'
          : 'UPSTREAM_ERROR';
  return Object.assign(new Error(code), { code });
}
