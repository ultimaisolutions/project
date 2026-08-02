import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache';
import { getConnection, markSynced } from './connections';
import { decryptSecret } from './crypto';
import { aggregateDashboard, type DashboardFilters } from './dashboard';
import { getServerEnv } from './env';
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
  apiKeyEncrypted: string;
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
    .update(connection.apiKeyEncrypted)
    .update('\0')
    .update(connection.spreadsheetId)
    .update('\0')
    .update(connection.worksheetName)
    .digest('base64url')
    .slice(0, 24);
  return `${userId}:${revision}`;
}

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
export async function loadSheetForUser(
  userId: string,
  refresh = false,
  timings: Timings = noTimings,
) {
  const connection = await timings.measure('db-connection', () => getConnection(userId));
  if (!connection) {
    throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED' });
  }

  const cacheKey = connectionCacheKey(userId, connection);
  let parsed = refresh
    ? null
    : cacheGet<Awaited<ReturnType<typeof fetchGoogleSheet>>>(cacheKey);
  let lastSyncAt = connection.lastSyncAt ? new Date(connection.lastSyncAt) : null;

  if (!parsed) {
    const encryptionKey = getServerEnv('SETTINGS_ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw Object.assign(new Error('SERVER_CONFIGURATION'), {
        code: 'SERVER_CONFIGURATION',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      parsed = await timings.measure('sheets-fetch', () => fetchGoogleSheet(
        decryptSecret(connection.apiKeyEncrypted, userId, encryptionKey),
        connection.spreadsheetId,
        connection.worksheetName,
        controller.signal,
      ));
      cacheSet(cacheKey, parsed);
      lastSyncAt = new Date();
      await timings.measure('db-mark-synced', () => markSynced(userId));
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    rows: parsed.rows,
    skippedRows: parsed.skippedRows,
    warnings: parsed.warnings,
    lastSyncAt,
    source: {
      spreadsheetId: connection.spreadsheetId,
      worksheetName: connection.worksheetName,
    },
  };
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
