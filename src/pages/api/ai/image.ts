import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  filtersFromSearchParams,
  loadSheetForUser,
} from '../../../lib/analytics';
import { buildAnalyticsSnapshot } from '../../../lib/ai/grounding';
import {
  generateMarketingImage,
  imageTypeSchema,
} from '../../../lib/ai/image';
import { assertJson, errorCode, json } from '../../../lib/http';

const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
  type: imageTypeSchema,
});

export const POST: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = requestSchema.parse(await request.json());
    const query = new URLSearchParams(input.query.replace(/^\?/, ''));
    const sheet = await loadSheetForUser(userId);
    const snapshot = buildAnalyticsSnapshot(
      sheet.rows,
      filtersFromSearchParams(query),
    );
    const image = await generateMarketingImage(snapshot, input.type, userId);
    return json({ image });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_INPUT' : errorCode(error);
    const status = code === 'INVALID_INPUT' || code === 'INVALID_ORIGIN' || code === 'INVALID_CONTENT_TYPE'
      ? 400
      : code === 'NO_DATA'
        ? 422
        : code === 'NOT_CONNECTED'
          ? 409
          : code === 'AI_NOT_CONFIGURED' || code === 'IMAGE_NOT_CONFIGURED'
            ? 503
            : 502;
    return json({ error: code }, status);
  }
};
