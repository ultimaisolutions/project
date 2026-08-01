import type { APIRoute } from 'astro';
import { z } from 'zod';
import { cacheInvalidate } from '../../../lib/cache';
import {
  getConnection,
  removeConnection,
  saveConnection,
} from '../../../lib/connections';
import {
  decryptSecret,
  encryptSecret,
  publicSettings,
} from '../../../lib/crypto';
import { assertJson, errorCode, json } from '../../../lib/http';
import { getServerEnv } from '../../../lib/env';
import { configuredSheetDefaults } from '../../../lib/server-settings';
import { fetchGoogleSheet, parseSpreadsheetId } from '../../../lib/sheets';

const schema = z.object({
  useServerDefaults: z.boolean().optional(),
  apiKey: z.string().trim().min(8).optional(),
  spreadsheetId: z.string().trim().min(8).optional(),
  worksheetName: z.string().trim().min(1).max(100).optional(),
});

const responseSettings = (settings: Parameters<typeof publicSettings>[0]) => ({
  ...publicSettings(settings),
  serverDefaultsAvailable: configuredSheetDefaults() !== null,
});

export const GET: APIRoute = async ({ locals }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);
  return json(responseSettings(await getConnection(userId)));
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = schema.parse(await request.json());
    const existing = await getConnection(userId);
    const encryptionKey = getServerEnv('SETTINGS_ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw Object.assign(new Error('SERVER_CONFIGURATION'), {
        code: 'SERVER_CONFIGURATION',
      });
    }

    const defaults = input.useServerDefaults ? configuredSheetDefaults() : null;
    if (input.useServerDefaults && !defaults) {
      throw Object.assign(new Error('SERVER_SHEET_NOT_CONFIGURED'), {
        code: 'SERVER_SHEET_NOT_CONFIGURED',
      });
    }
    const apiKey = defaults?.apiKey
      ?? input.apiKey
      ?? (existing
        ? decryptSecret(existing.apiKeyEncrypted, userId, encryptionKey)
        : null);
    const spreadsheetInput = defaults?.spreadsheetId
      ?? input.spreadsheetId
      ?? existing?.spreadsheetId;
    const worksheetName = defaults?.worksheetName
      ?? input.worksheetName
      ?? existing?.worksheetName;
    if (!apiKey) {
      throw Object.assign(new Error('API_KEY_REQUIRED'), {
        code: 'API_KEY_REQUIRED',
      });
    }
    if (!spreadsheetInput || !worksheetName) {
      throw Object.assign(new Error('INVALID_INPUT'), {
        code: 'INVALID_INPUT',
      });
    }

    const spreadsheetId = parseSpreadsheetId(spreadsheetInput);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      await fetchGoogleSheet(
        apiKey,
        spreadsheetId,
        worksheetName,
        controller.signal,
      );
    } finally {
      clearTimeout(timeout);
    }
    const saved = await saveConnection({
      clerkUserId: userId,
      apiKeyEncrypted: encryptSecret(apiKey, userId, encryptionKey),
      apiKeyLastFour: apiKey.slice(-4),
      spreadsheetId,
      worksheetName,
      status: 'CONNECTED',
      lastErrorCode: null,
      lastTestedAt: new Date(),
      lastSyncAt: existing?.lastSyncAt ?? null,
    });
    cacheInvalidate(`${userId}:`);
    return json(responseSettings(saved));
  } catch (error) {
    const code = error instanceof z.ZodError
      ? 'INVALID_INPUT'
      : (error as Error).name === 'AbortError'
        ? 'TIMEOUT'
        : errorCode(error);
    return json({ error: code }, 400);
  }
};

export const DELETE: APIRoute = async ({ locals }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);
  await removeConnection(userId);
  cacheInvalidate(`${userId}:`);
  return json(responseSettings(null));
};
