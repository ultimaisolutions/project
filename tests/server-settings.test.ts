import { describe, expect, test } from 'bun:test';
import * as serverSettings from '../src/lib/server-settings';

const defaults = {
  apiKey: 'AIza-system-secret',
  spreadsheetId: 'system-sheet-id',
  worksheetName: 'נתונים',
};

const stored = {
  clerkUserId: 'user_123',
  apiKeyEncrypted: 'encrypted-user-key',
  apiKeyLastFour: 'user',
  spreadsheetId: 'user-sheet-id',
  worksheetName: 'מותאם',
  status: 'CONNECTED',
  lastErrorCode: null,
  lastTestedAt: new Date('2026-08-02T10:00:00.000Z'),
  lastSyncAt: new Date('2026-08-02T11:00:00.000Z'),
} as const;

type StoredConnection = Omit<typeof stored, 'status'> & {
  status: 'CONNECTED' | 'DISCONNECTED';
};

type Resolver = (
  userId: string,
  connection: StoredConnection | null,
  systemDefaults: typeof defaults | null,
  encryptionKey: string | undefined,
  decrypt: (payload: string, userId: string, key: string) => string,
) => unknown;

type Presenter = (
  connection: StoredConnection | null,
  systemDefaults: typeof defaults | null,
) => unknown;

const resolveEffectiveSheetConnection = (serverSettings as unknown as {
  resolveEffectiveSheetConnection?: Resolver;
}).resolveEffectiveSheetConnection;

const publicEffectiveSettings = (serverSettings as unknown as {
  publicEffectiveSettings?: Presenter;
}).publicEffectiveSettings;

const completeSheetDefaults = (serverSettings as unknown as {
  completeSheetDefaults?: (
    apiKey: string | undefined,
    spreadsheetId: string | undefined,
    worksheetName: string | undefined,
  ) => typeof defaults | null;
}).completeSheetDefaults;

describe('shared Sheet environment configuration', () => {
  test('accepts only a complete three-variable set', () => {
    expect(completeSheetDefaults?.(
      defaults.apiKey,
      defaults.spreadsheetId,
      defaults.worksheetName,
    )).toEqual(defaults);
    expect(completeSheetDefaults?.(
      defaults.apiKey,
      undefined,
      defaults.worksheetName,
    )).toBeNull();
  });
});

describe('effective Google Sheet connection', () => {
  test('uses complete environment defaults when the user has no stored connection', () => {
    const actual = resolveEffectiveSheetConnection?.(
      'user_123',
      null,
      defaults,
      undefined,
      () => 'must-not-decrypt',
    );

    expect(actual).toEqual({
      source: 'environment',
      apiKey: 'AIza-system-secret',
      spreadsheetId: 'system-sheet-id',
      worksheetName: 'נתונים',
      lastSyncAt: null,
    });
  });

  test('prefers a stored custom connection and decrypts it for its Clerk user', () => {
    const actual = resolveEffectiveSheetConnection?.(
      'user_123',
      stored,
      defaults,
      'encryption-key',
      (payload, userId, key) => `${payload}:${userId}:${key}`,
    );

    expect(actual).toEqual({
      source: 'user',
      apiKey: 'encrypted-user-key:user_123:encryption-key',
      spreadsheetId: 'user-sheet-id',
      worksheetName: 'מותאם',
      lastSyncAt: new Date('2026-08-02T11:00:00.000Z'),
    });
  });

  test('treats DISCONNECTED as an explicit opt-out from environment defaults', () => {
    const actual = resolveEffectiveSheetConnection?.(
      'user_123',
      { ...stored, status: 'DISCONNECTED' },
      defaults,
      'encryption-key',
      () => 'must-not-decrypt',
    );

    expect(actual).toBeNull();
  });
});

describe('public effective settings', () => {
  test('presents environment defaults without leaking key characters', () => {
    expect(publicEffectiveSettings?.(null, defaults)).toEqual({
      apiKeyConfigured: true,
      maskedApiKey: '•••• •••• •••• ••••',
      spreadsheetId: 'system-sheet-id',
      worksheetName: 'נתונים',
      status: 'CONNECTED',
      lastTestedAt: null,
      lastSyncAt: null,
      lastErrorCode: null,
      connectionSource: 'environment',
      serverDefaultsAvailable: true,
    });
    expect(JSON.stringify(publicEffectiveSettings?.(null, defaults))).not.toContain('secret');
  });

  test('presents a disconnected stored connection without falling back', () => {
    expect(publicEffectiveSettings?.(
      { ...stored, status: 'DISCONNECTED' },
      defaults,
    )).toMatchObject({
      connectionSource: 'none',
      status: 'DISCONNECTED',
      spreadsheetId: 'user-sheet-id',
      serverDefaultsAvailable: true,
    });
  });
});
