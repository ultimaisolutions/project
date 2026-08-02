import type { APIRoute } from 'astro';
import { z } from 'zod';
import { testDataSettings } from '../../../lib/data-settings';
import { assertJson, errorCode, json } from '../../../lib/http';

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
    return json(await testDataSettings(userId, input));
  } catch (error) {
    const code = error instanceof z.ZodError
      ? 'INVALID_INPUT'
      : (error as Error).name === 'AbortError'
        ? 'TIMEOUT'
        : errorCode(error);
    return json({ error: code }, 400);
  }
};
