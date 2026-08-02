import { describe, expect, test } from 'bun:test';
import * as analytics from '../src/lib/analytics';
import { noTimings } from '../src/lib/timing';

type LoaderDependencies = {
  getConnection: (userId: string) => Promise<null>;
  configuredSheetDefaults: () => {
    apiKey: string;
    spreadsheetId: string;
    worksheetName: string;
  };
  getEncryptionKey: () => string | undefined;
  cacheGet: <T>(key: string) => T | null;
  cacheSet: <T>(key: string, value: T) => void;
  fetchGoogleSheet: (
    apiKey: string,
    spreadsheetId: string,
    worksheetName: string,
    signal?: AbortSignal,
  ) => Promise<{
    rows: Array<{ rowId: string }>;
    skippedRows: number;
    warnings: string[];
  }>;
  markSynced: (userId: string) => Promise<unknown>;
  now: () => Date;
};

const loadSheetForUserWithDependencies = (analytics as unknown as {
  loadSheetForUserWithDependencies?: (
    userId: string,
    refresh: boolean,
    timings: typeof noTimings,
    dependencies: LoaderDependencies,
  ) => Promise<unknown>;
}).loadSheetForUserWithDependencies;

describe('environment-backed analytics loading', () => {
  test('loads a new user immediately and preserves the fetch timestamp on a cache hit', async () => {
    const cache = new Map<string, unknown>();
    let fetchCount = 0;
    const dependencies: LoaderDependencies = {
      getConnection: async () => null,
      configuredSheetDefaults: () => ({
        apiKey: 'AIza-system-secret',
        spreadsheetId: 'system-sheet-id',
        worksheetName: 'נתונים',
      }),
      getEncryptionKey: () => undefined,
      cacheGet: <T,>(key: string) => (cache.get(key) as T | undefined) ?? null,
      cacheSet: <T,>(key: string, value: T) => { cache.set(key, value); },
      fetchGoogleSheet: async () => {
        fetchCount += 1;
        return {
          rows: [{ rowId: 'R1' }],
          skippedRows: 0,
          warnings: [],
        };
      },
      markSynced: async () => { throw new Error('environment sources must not write sync metadata'); },
      now: () => new Date('2026-08-02T12:00:00.000Z'),
    };

    const first = await loadSheetForUserWithDependencies?.(
      'user_new',
      false,
      noTimings,
      dependencies,
    );
    const second = await loadSheetForUserWithDependencies?.(
      'user_new',
      false,
      noTimings,
      dependencies,
    );

    expect(first).toEqual({
      rows: [{ rowId: 'R1' }],
      skippedRows: 0,
      warnings: [],
      lastSyncAt: new Date('2026-08-02T12:00:00.000Z'),
      source: {
        spreadsheetId: 'system-sheet-id',
        worksheetName: 'נתונים',
      },
    });
    expect(second).toEqual(first);
    expect(fetchCount).toBe(1);
  });
});
