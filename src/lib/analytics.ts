import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache';
import { getConnection, markSynced } from './connections';
import { aggregateDashboard, type DashboardFilters } from './dashboard';
import { getServerEnv } from './env';
import {
  configuredSheetDefaults,
  resolveEffectiveSheetConnection,
} from './server-settings';
import { fetchGoogleSheet } from './sheets';
import { noTimings, type Timings } from './timing';

/** Reads, trims, and bounds a repeated query-string filter. */
const many = (query: URLSearchParams, key: string) => query.getAll(key)
  .map((value) => value.trim())
  .filter((value) => value.length > 0 && value.length <= 100)
  .slice(0, 50);

/** Accepts date-shaped query values and ignores absent or malformed values. */
const date = (value: string | null) => value && /^\d{4}-\d{2}-\d{2}$/.test(value)
  ? value
  : undefined;

type ConnectionCacheIdentity = {
  apiKey: string;
  spreadsheetId: string;
  worksheetName: string;
  updatedAt?: unknown;
  lastSyncAt?: unknown;
};

/**
 * Builds a per-user cache key tied to the credentials and worksheet identity.
 * Sync timestamps are intentionally excluded because they do not change the source data.
 */
export function connectionCacheKey(
  userId: string,
  connection: ConnectionCacheIdentity,
) {
  const revision = createHash('sha256')
    .update(connection.apiKey)
    .update('\0')
    .update(connection.spreadsheetId)
    .update('\0')
    .update(connection.worksheetName)
    .digest('base64url')
    .slice(0, 24);
  return `${userId}:${revision}`;
}

type ParsedSheet = Awaited<ReturnType<typeof fetchGoogleSheet>>;
type SheetCacheEntry = { parsed: ParsedSheet; lastSyncAt: Date };

type SheetLoaderDependencies = {
  getConnection: typeof getConnection;
  configuredSheetDefaults: typeof configuredSheetDefaults;
  getEncryptionKey: () => string | undefined;
  cacheGet: typeof cacheGet;
  cacheSet: typeof cacheSet;
  fetchGoogleSheet: typeof fetchGoogleSheet;
  markSynced: typeof markSynced;
  now: () => Date;
};

const sheetLoaderDependencies: SheetLoaderDependencies = {
  getConnection,
  configuredSheetDefaults,
  getEncryptionKey: () => getServerEnv('SETTINGS_ENCRYPTION_KEY'),
  cacheGet,
  cacheSet,
  fetchGoogleSheet,
  markSynced,
  now: () => new Date(),
};

/** Converts dashboard URL parameters into normalized, bounded filters. */
export function filtersFromSearchParams(query: URLSearchParams): DashboardFilters {
  return {
    from: date(query.get('from')),
    to: date(query.get('to')),
    campaigns: many(query, 'campaign'),
    channels: many(query, 'channel'),
    salespeople: many(query, 'salesperson'),
    regions: many(query, 'region'),
    products: many(query, 'product'),
  };
}

/**
 * Loads the user's configured worksheet, reusing cached parsed rows unless a refresh
 * is requested, and records successful upstream synchronizations.
 */
export async function loadSheetForUserWithDependencies(
  userId: string,
  refresh = false,
  timings: Timings = noTimings,
  dependencies: SheetLoaderDependencies = sheetLoaderDependencies,
) {
  const stored = await timings.measure(
    'db-connection',
    () => dependencies.getConnection(userId),
  );
  const connection = resolveEffectiveSheetConnection(
    userId,
    stored,
    dependencies.configuredSheetDefaults(),
    dependencies.getEncryptionKey(),
  );
  if (!connection) {
    throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED' });
  }

  const cacheKey = connectionCacheKey(userId, connection);
  let cached = refresh
    ? null
    : dependencies.cacheGet<SheetCacheEntry>(cacheKey);

  if (!cached) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const parsed = await timings.measure('sheets-fetch', () => dependencies.fetchGoogleSheet(
        connection.apiKey,
        connection.spreadsheetId,
        connection.worksheetName,
        controller.signal,
      ));
      cached = { parsed, lastSyncAt: dependencies.now() };
      dependencies.cacheSet(cacheKey, cached);
      if (connection.source === 'user') {
        await timings.measure('db-mark-synced', () => dependencies.markSynced(userId));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    rows: cached.parsed.rows,
    skippedRows: cached.parsed.skippedRows,
    warnings: cached.parsed.warnings,
    lastSyncAt: cached.lastSyncAt,
    source: {
      spreadsheetId: connection.spreadsheetId,
      worksheetName: connection.worksheetName,
    },
  };
}

/** Loads the effective user or environment-backed worksheet. */
export async function loadSheetForUser(
  userId: string,
  refresh = false,
  timings: Timings = noTimings,
) {
  return loadSheetForUserWithDependencies(userId, refresh, timings);
}

/** Loads the user's worksheet and aggregates it using filters from the request URL. */
export async function loadDashboardForUser(
  userId: string,
  query: URLSearchParams,
  refresh = false,
  timings: Timings = noTimings,
) {
  const sheet = await loadSheetForUser(userId, refresh, timings);
  const dashboard = await timings.measure(
    'aggregate',
    async () => aggregateDashboard(sheet.rows, filtersFromSearchParams(query)),
  );
  return { sheet, dashboard };
}
