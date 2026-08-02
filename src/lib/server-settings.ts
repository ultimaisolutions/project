import { getServerEnv } from './env';

/** Returns complete environment-provided sheet defaults, or `null` if any are missing. */
export function configuredSheetDefaults() {
  const apiKey = getServerEnv('GOOGLE_SHEETS_API');
  const spreadsheetId = getServerEnv('SHEET_ID');
  const worksheetName = getServerEnv('SHEET_NAME');
  return apiKey && spreadsheetId && worksheetName
    ? { apiKey, spreadsheetId, worksheetName }
    : null;
}
