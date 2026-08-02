import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  getConnection,
} from '../../../lib/connections';
import {
  disconnectDataSettings,
  restoreDefaultDataSettings,
  saveDataSettings,
} from '../../../lib/data-settings';
import { assertJson, errorCode, json } from '../../../lib/http';
import {
  configuredSheetDefaults,
  publicEffectiveSettings,
} from '../../../lib/server-settings';

const schema = z.object({
  useServerDefaults: z.boolean().optional(),
  apiKey: z.string().trim().min(8).optional(),
  spreadsheetId: z.string().trim().min(8).optional(),
  worksheetName: z.string().trim().min(1).max(100).optional(),
});

export const GET: APIRoute = async ({ locals }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);
  return json(publicEffectiveSettings(
    await getConnection(userId),
    configuredSheetDefaults(),
  ));
};

export const PUT: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = schema.parse(await request.json());
    const result = input.useServerDefaults
      ? await restoreDefaultDataSettings(userId)
      : await saveDataSettings(userId, input);
    return json(result);
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
  try {
    return json(await disconnectDataSettings(userId));
  } catch (error) {
    return json({ error: errorCode(error) }, 400);
  }
};
