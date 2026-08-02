import { describe, expect, test } from 'bun:test';
import * as serviceModule from '../src/lib/data-settings';

const defaults = {
  apiKey: 'AIza-system-secret',
  spreadsheetId: 'system-sheet-id',
  worksheetName: 'נתונים',
};

type Stored = {
  clerkUserId: string;
  apiKeyEncrypted: string;
  apiKeyLastFour: string;
  spreadsheetId: string;
  worksheetName: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
  lastErrorCode: string | null;
  lastTestedAt: Date | null;
  lastSyncAt: Date | null;
};

type Dependencies = {
  getConnection: (userId: string) => Promise<Stored | null>;
  saveConnection: (input: Stored) => Promise<Stored>;
  removeConnection: (userId: string) => Promise<unknown>;
  configuredSheetDefaults: () => typeof defaults | null;
  getEncryptionKey: () => string | undefined;
  encryptSecret: (secret: string, userId: string, key: string) => string;
  decryptSecret: (payload: string, userId: string, key: string) => string;
  validateConnection: (
    apiKey: string,
    spreadsheetId: string,
    worksheetName: string,
  ) => Promise<{ spreadsheetId: string }>;
  invalidateCache: (prefix: string) => void;
  now: () => Date;
};

type SettingsInput = {
  apiKey?: string;
  spreadsheetId?: string;
  worksheetName?: string;
};

type Service = {
  testDataSettings?: (
    userId: string,
    input: SettingsInput,
    dependencies: Dependencies,
  ) => Promise<unknown>;
  saveDataSettings?: (
    userId: string,
    input: SettingsInput,
    dependencies: Dependencies,
  ) => Promise<unknown>;
  disconnectDataSettings?: (
    userId: string,
    dependencies: Dependencies,
  ) => Promise<unknown>;
  restoreDefaultDataSettings?: (
    userId: string,
    dependencies: Dependencies,
  ) => Promise<unknown>;
};

const {
  testDataSettings,
  saveDataSettings,
  disconnectDataSettings,
  restoreDefaultDataSettings,
} = serviceModule as unknown as Service;

function harness(initial: Stored | null = null) {
  let stored = initial;
  const dependencies: Dependencies = {
    getConnection: async () => stored,
    saveConnection: async (input) => {
      stored = input;
      return input;
    },
    removeConnection: async () => {
      stored = null;
      return null;
    },
    configuredSheetDefaults: () => defaults,
    getEncryptionKey: () => 'encryption-key',
    encryptSecret: (secret, userId, key) => `encrypted:${secret}:${userId}:${key}`,
    decryptSecret: (payload) => payload.replace('encrypted:', '').split(':')[0]!,
    validateConnection: async (_apiKey, spreadsheetId) => ({ spreadsheetId }),
    invalidateCache: () => undefined,
    now: () => new Date('2026-08-02T12:00:00.000Z'),
  };
  return { dependencies, read: () => stored };
}

describe('data settings service', () => {
  test('tests environment-backed fields without exposing or storing the shared key', async () => {
    const state = harness();
    state.dependencies.validateConnection = async () => ({
      spreadsheetId: 'system-sheet-id',
      rows: [{ rowId: 'R1' }, { rowId: 'R2' }],
      skippedRows: 1,
      warnings: ['INVALID_DATE'],
    });

    const result = await testDataSettings?.('user_123', {
      spreadsheetId: 'system-sheet-id',
      worksheetName: 'נתונים',
    }, state.dependencies);

    expect(result).toEqual({
      ok: true,
      validRows: 2,
      skippedRows: 1,
      warnings: ['INVALID_DATE'],
    });
    expect(state.read()).toBeNull();
  });

  test('saves a custom override with the environment key when the key field is blank', async () => {
    const state = harness();

    const result = await saveDataSettings?.('user_123', {
      spreadsheetId: 'custom-sheet-id',
      worksheetName: 'מותאם',
    }, state.dependencies);

    expect(state.read()).toMatchObject({
      clerkUserId: 'user_123',
      apiKeyEncrypted: 'encrypted:AIza-system-secret:user_123:encryption-key',
      apiKeyLastFour: '••••',
      spreadsheetId: 'custom-sheet-id',
      worksheetName: 'מותאם',
      status: 'CONNECTED',
    });
    expect(result).toMatchObject({
      connectionSource: 'user',
      status: 'CONNECTED',
      maskedApiKey: '•••• •••• •••• ••••',
    });
    expect(JSON.stringify(result)).not.toContain('cret');
  });

  test('disconnects an environment-backed user without allowing automatic fallback', async () => {
    const state = harness();

    const result = await disconnectDataSettings?.('user_123', state.dependencies);

    expect(state.read()).toMatchObject({
      clerkUserId: 'user_123',
      status: 'DISCONNECTED',
      spreadsheetId: 'system-sheet-id',
      worksheetName: 'נתונים',
    });
    expect(result).toMatchObject({
      connectionSource: 'none',
      status: 'DISCONNECTED',
      maskedApiKey: '•••• •••• •••• ••••',
      serverDefaultsAvailable: true,
    });
    expect(JSON.stringify(result)).not.toContain('cret');
  });

  test('validates the system source before removing an override and restoring defaults', async () => {
    const state = harness({
      clerkUserId: 'user_123',
      apiKeyEncrypted: 'encrypted:custom-secret:user_123:encryption-key',
      apiKeyLastFour: 'cret',
      spreadsheetId: 'custom-sheet-id',
      worksheetName: 'מותאם',
      status: 'CONNECTED',
      lastErrorCode: null,
      lastTestedAt: null,
      lastSyncAt: null,
    });

    const result = await restoreDefaultDataSettings?.('user_123', state.dependencies);

    expect(state.read()).toBeNull();
    expect(result).toMatchObject({
      connectionSource: 'environment',
      spreadsheetId: 'system-sheet-id',
      worksheetName: 'נתונים',
    });
  });

  test('keeps the custom connection when environment validation fails', async () => {
    const initial: Stored = {
      clerkUserId: 'user_123',
      apiKeyEncrypted: 'encrypted:custom-secret:user_123:encryption-key',
      apiKeyLastFour: 'cret',
      spreadsheetId: 'custom-sheet-id',
      worksheetName: 'מותאם',
      status: 'CONNECTED',
      lastErrorCode: null,
      lastTestedAt: null,
      lastSyncAt: null,
    };
    const state = harness(initial);
    state.dependencies.validateConnection = async () => {
      throw Object.assign(new Error('SPREADSHEET_NOT_FOUND'), {
        code: 'SPREADSHEET_NOT_FOUND',
      });
    };

    expect(restoreDefaultDataSettings?.('user_123', state.dependencies))
      .rejects.toThrow('SPREADSHEET_NOT_FOUND');
    expect(state.read()).toBe(initial);
  });
});
