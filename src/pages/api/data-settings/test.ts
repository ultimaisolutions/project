import type { APIRoute } from 'astro';
import { z } from 'zod';
import { getConnection } from '../../../lib/connections';
import { decryptSecret } from '../../../lib/crypto';
import { getServerEnv } from '../../../lib/env';
import { assertJson, errorCode, json } from '../../../lib/http';
import { fetchGoogleSheet, parseSpreadsheetId } from '../../../lib/sheets';

const schema = z.object({
  apiKey: z.string().trim().min(8).optional(),
  spreadsheetId: z.string().trim().min(8),
  worksheetName: z.string().trim().min(1),
});

export const POST: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = schema.parse(await request.json());
    const stored = await getConnection(userId);
    const encryptionKey = getServerEnv('SETTINGS_ENCRYPTION_KEY');
    const apiKey = input.apiKey
      ?? (stored && encryptionKey
        ? decryptSecret(stored.apiKeyEncrypted, userId, encryptionKey)
        : null);
    if (!apiKey) {
      throw Object.assign(new Error('API_KEY_REQUIRED'), {
        code: 'API_KEY_REQUIRED',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const parsed = await fetchGoogleSheet(
        apiKey,
        parseSpreadsheetId(input.spreadsheetId),
        input.worksheetName,
        controller.signal,
      );
      return json({
        ok: true,
        validRows: parsed.rows.length,
        skippedRows: parsed.skippedRows,
        warnings: parsed.warnings,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const code = error instanceof z.ZodError
      ? 'INVALID_INPUT'
      : (error as Error).name === 'AbortError'
        ? 'TIMEOUT'
        : errorCode(error);
    return json({ error: code }, 400);
  }
};
