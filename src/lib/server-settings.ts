import { getServerEnv } from './env';

export function configuredSheetDefaults() {
  const apiKey = getServerEnv('GOOGLE_SHEETS_API');
  const spreadsheetId = getServerEnv('SHEET_ID');
  const worksheetName = getServerEnv('SHEET_NAME');
  return apiKey && spreadsheetId && worksheetName
    ? { apiKey, spreadsheetId, worksheetName }
    : null;
}
