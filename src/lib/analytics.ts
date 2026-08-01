import { createHash } from 'node:crypto';
import { cacheGet, cacheSet } from './cache';
import { decryptSecret } from './crypto';
import { aggregateDashboard, type DashboardFilters } from './dashboard';
import { getServerEnv } from './env';
import { fetchGoogleSheet } from './sheets';

const many = (query: URLSearchParams, key: string) => query.getAll(key)
  .map((value) => value.trim())
  .filter((value) => value.length > 0 && value.length <= 100)
  .slice(0, 50);

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

export async function loadSheetForUser(userId: string, refresh = false) {
  const { getConnection, markSynced } = await import('./connections');
  const connection = await getConnection(userId);
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
      parsed = await fetchGoogleSheet(
        decryptSecret(connection.apiKeyEncrypted, userId, encryptionKey),
        connection.spreadsheetId,
        connection.worksheetName,
        controller.signal,
      );
      cacheSet(cacheKey, parsed);
      lastSyncAt = new Date();
      await markSynced(userId);
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

export async function loadDashboardForUser(
  userId: string,
  query: URLSearchParams,
  refresh = false,
) {
  const sheet = await loadSheetForUser(userId, refresh);
  const dashboard = aggregateDashboard(sheet.rows, filtersFromSearchParams(query));
  return { sheet, dashboard };
}
