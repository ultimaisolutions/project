import { cacheInvalidate } from './cache';
import {
  getConnection,
  removeConnection,
  saveConnection,
} from './connections';
import { decryptSecret, encryptSecret } from './crypto';
import { getServerEnv } from './env';
import {
  configuredSheetDefaults,
  publicEffectiveSettings,
  type SheetDefaults,
} from './server-settings';
import { fetchGoogleSheet, parseSpreadsheetId } from './sheets';

type StoredSheetConnection = {
  clerkUserId: string;
  apiKeyEncrypted: string;
  apiKeyLastFour: string;
  spreadsheetId: string;
  worksheetName: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  lastErrorCode?: string | null;
  lastTestedAt?: Date | null;
  lastSyncAt?: Date | null;
};

export type DataSettingsInput = {
  apiKey?: string;
  spreadsheetId?: string;
  worksheetName?: string;
};

type DataSettingsDependencies = {
  getConnection: (userId: string) => Promise<StoredSheetConnection | null>;
  saveConnection: (input: StoredSheetConnection) => Promise<StoredSheetConnection>;
  removeConnection: (userId: string) => Promise<unknown>;
  configuredSheetDefaults: () => SheetDefaults | null;
  getEncryptionKey: () => string | undefined;
  encryptSecret: typeof encryptSecret;
  decryptSecret: typeof decryptSecret;
  validateConnection: (
    apiKey: string,
    spreadsheetId: string,
    worksheetName: string,
  ) => Promise<{
    rows?: unknown[];
    skippedRows?: number;
    warnings?: unknown[];
  }>;
  invalidateCache: (prefix: string) => void;
  now: () => Date;
};

/** Validates a Sheet connection with the same bounded timeout used by analytics. */
async function validateConnection(
  apiKey: string,
  spreadsheetId: string,
  worksheetName: string,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetchGoogleSheet(apiKey, spreadsheetId, worksheetName, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

const runtimeDependencies: DataSettingsDependencies = {
  getConnection,
  saveConnection,
  removeConnection,
  configuredSheetDefaults,
  getEncryptionKey: () => getServerEnv('SETTINGS_ENCRYPTION_KEY'),
  encryptSecret,
  decryptSecret,
  validateConnection,
  invalidateCache: cacheInvalidate,
  now: () => new Date(),
};

function requiredEncryptionKey(dependencies: DataSettingsDependencies) {
  const key = dependencies.getEncryptionKey();
  if (!key) {
    throw Object.assign(new Error('SERVER_CONFIGURATION'), {
      code: 'SERVER_CONFIGURATION',
    });
  }
  return key;
}

function requiredDefaults(dependencies: DataSettingsDependencies) {
  const defaults = dependencies.configuredSheetDefaults();
  if (!defaults) {
    throw Object.assign(new Error('SERVER_SHEET_NOT_CONFIGURED'), {
      code: 'SERVER_SHEET_NOT_CONFIGURED',
    });
  }
  return defaults;
}

function reusableApiKey(
  userId: string,
  inputKey: string | undefined,
  stored: StoredSheetConnection | null,
  defaults: SheetDefaults | null,
  encryptionKey: string | undefined,
  dependencies: DataSettingsDependencies,
) {
  const apiKey = inputKey
    ?? (stored
      ? dependencies.decryptSecret(
        stored.apiKeyEncrypted,
        userId,
        encryptionKey ?? requiredEncryptionKey(dependencies),
      )
      : defaults?.apiKey);
  if (!apiKey) {
    throw Object.assign(new Error('API_KEY_REQUIRED'), {
      code: 'API_KEY_REQUIRED',
    });
  }
  return apiKey;
}

/** Tests form values against the effective stored or environment key without persisting. */
export async function testDataSettings(
  userId: string,
  input: DataSettingsInput,
  dependencies: DataSettingsDependencies = runtimeDependencies,
) {
  const existing = await dependencies.getConnection(userId);
  const defaults = dependencies.configuredSheetDefaults();
  const apiKey = reusableApiKey(
    userId,
    input.apiKey,
    existing,
    defaults,
    dependencies.getEncryptionKey(),
    dependencies,
  );
  const spreadsheetInput = input.spreadsheetId
    ?? existing?.spreadsheetId
    ?? defaults?.spreadsheetId;
  const worksheetName = input.worksheetName
    ?? existing?.worksheetName
    ?? defaults?.worksheetName;
  if (!spreadsheetInput || !worksheetName) {
    throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  }

  const parsed = await dependencies.validateConnection(
    apiKey,
    parseSpreadsheetId(spreadsheetInput),
    worksheetName,
  );
  return {
    ok: true,
    validRows: parsed.rows?.length ?? 0,
    skippedRows: parsed.skippedRows ?? 0,
    warnings: parsed.warnings ?? [],
  };
}

/** Validates and stores a per-user override, reusing a server-side key when omitted. */
export async function saveDataSettings(
  userId: string,
  input: DataSettingsInput,
  dependencies: DataSettingsDependencies = runtimeDependencies,
) {
  const existing = await dependencies.getConnection(userId);
  const defaults = dependencies.configuredSheetDefaults();
  const encryptionKey = requiredEncryptionKey(dependencies);
  const apiKey = reusableApiKey(
    userId,
    input.apiKey,
    existing,
    defaults,
    encryptionKey,
    dependencies,
  );
  const spreadsheetInput = input.spreadsheetId
    ?? existing?.spreadsheetId
    ?? defaults?.spreadsheetId;
  const worksheetName = input.worksheetName
    ?? existing?.worksheetName
    ?? defaults?.worksheetName;
  if (!spreadsheetInput || !worksheetName) {
    throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
  }

  const spreadsheetId = parseSpreadsheetId(spreadsheetInput);
  await dependencies.validateConnection(apiKey, spreadsheetId, worksheetName);
  const saved = await dependencies.saveConnection({
    clerkUserId: userId,
    apiKeyEncrypted: dependencies.encryptSecret(apiKey, userId, encryptionKey),
    apiKeyLastFour: input.apiKey
      ? apiKey.slice(-4)
      : existing?.apiKeyLastFour ?? '••••',
    spreadsheetId,
    worksheetName,
    status: 'CONNECTED',
    lastErrorCode: null,
    lastTestedAt: dependencies.now(),
    lastSyncAt: existing?.lastSyncAt ?? null,
  });
  dependencies.invalidateCache(`${userId}:`);
  return publicEffectiveSettings(saved, defaults);
}

/** Persists an explicit opt-out while retaining encrypted details for reconnection. */
export async function disconnectDataSettings(
  userId: string,
  dependencies: DataSettingsDependencies = runtimeDependencies,
) {
  const existing = await dependencies.getConnection(userId);
  const defaults = dependencies.configuredSheetDefaults();
  let disconnected = existing;

  if (existing) {
    disconnected = await dependencies.saveConnection({
      ...existing,
      status: 'DISCONNECTED',
    });
  } else if (defaults) {
    const encryptionKey = requiredEncryptionKey(dependencies);
    disconnected = await dependencies.saveConnection({
      clerkUserId: userId,
      apiKeyEncrypted: dependencies.encryptSecret(
        defaults.apiKey,
        userId,
        encryptionKey,
      ),
      apiKeyLastFour: '••••',
      spreadsheetId: parseSpreadsheetId(defaults.spreadsheetId),
      worksheetName: defaults.worksheetName,
      status: 'DISCONNECTED',
      lastErrorCode: null,
      lastTestedAt: null,
      lastSyncAt: null,
    });
  }

  dependencies.invalidateCache(`${userId}:`);
  return publicEffectiveSettings(disconnected, defaults);
}

/** Validates the shared source before removing the user's persisted state. */
export async function restoreDefaultDataSettings(
  userId: string,
  dependencies: DataSettingsDependencies = runtimeDependencies,
) {
  const defaults = requiredDefaults(dependencies);
  const spreadsheetId = parseSpreadsheetId(defaults.spreadsheetId);
  await dependencies.validateConnection(
    defaults.apiKey,
    spreadsheetId,
    defaults.worksheetName,
  );
  await dependencies.removeConnection(userId);
  dependencies.invalidateCache(`${userId}:`);
  return publicEffectiveSettings(
    null,
    { ...defaults, spreadsheetId },
  );
}
