import { getServerEnv } from './env';
import { decryptSecret, publicSettings } from './crypto';

export type SheetDefaults = {
  apiKey: string;
  spreadsheetId: string;
  worksheetName: string;
};

type StoredSheetConnection = {
  apiKeyEncrypted: string;
  apiKeyLastFour: string;
  spreadsheetId: string;
  worksheetName: string;
  status: string;
  lastErrorCode?: string | null;
  lastTestedAt?: Date | string | null;
  lastSyncAt?: Date | string | null;
};

export type EffectiveSheetConnection = {
  source: 'environment' | 'user';
  apiKey: string;
  spreadsheetId: string;
  worksheetName: string;
  lastSyncAt: Date | string | null;
};

/** Returns complete environment-provided sheet defaults, or `null` if any are missing. */
export function completeSheetDefaults(
  apiKey: string | undefined,
  spreadsheetId: string | undefined,
  worksheetName: string | undefined,
): SheetDefaults | null {
  return apiKey && spreadsheetId && worksheetName
    ? { apiKey, spreadsheetId, worksheetName }
    : null;
}

/** Returns complete environment-provided sheet defaults, or `null` if any are missing. */
export function configuredSheetDefaults() {
  return completeSheetDefaults(
    getServerEnv('GOOGLE_SHEETS_API'),
    getServerEnv('SHEET_ID'),
    getServerEnv('SHEET_NAME'),
  );
}

/** Resolves the active server-only credentials without bypassing an explicit disconnect. */
export function resolveEffectiveSheetConnection(
  userId: string,
  stored: StoredSheetConnection | null,
  defaults: SheetDefaults | null,
  encryptionKey: string | undefined,
  decrypt: typeof decryptSecret = decryptSecret,
): EffectiveSheetConnection | null {
  if (stored?.status === 'DISCONNECTED') return null;

  if (stored) {
    if (!encryptionKey) {
      throw Object.assign(new Error('SERVER_CONFIGURATION'), {
        code: 'SERVER_CONFIGURATION',
      });
    }
    return {
      source: 'user',
      apiKey: decrypt(stored.apiKeyEncrypted, userId, encryptionKey),
      spreadsheetId: stored.spreadsheetId,
      worksheetName: stored.worksheetName,
      lastSyncAt: stored.lastSyncAt ?? null,
    };
  }

  return defaults
    ? { source: 'environment', ...defaults, lastSyncAt: null }
    : null;
}

/** Builds the secret-free settings DTO for custom, shared-default, and disconnected states. */
export function publicEffectiveSettings(
  stored: StoredSheetConnection | null,
  defaults: SheetDefaults | null,
) {
  const serverDefaultsAvailable = defaults !== null;
  if (stored) {
    return {
      ...publicSettings(stored),
      connectionSource: stored.status === 'DISCONNECTED' ? 'none' : 'user',
      serverDefaultsAvailable,
    } as const;
  }
  if (defaults) {
    return {
      apiKeyConfigured: true,
      maskedApiKey: '•••• •••• •••• ••••',
      spreadsheetId: defaults.spreadsheetId,
      worksheetName: defaults.worksheetName,
      status: 'CONNECTED',
      lastTestedAt: null,
      lastSyncAt: null,
      lastErrorCode: null,
      connectionSource: 'environment',
      serverDefaultsAvailable: true,
    } as const;
  }
  return {
    ...publicSettings(null),
    connectionSource: 'none',
    serverDefaultsAvailable: false,
  } as const;
}
