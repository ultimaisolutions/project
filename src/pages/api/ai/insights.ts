import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  filtersFromSearchParams,
  loadSheetForUser,
} from '../../../lib/analytics';
import { buildAnalyticsSnapshot } from '../../../lib/ai/grounding';
import { generateGroundedInsights } from '../../../lib/ai/insights';
import { assertJson, errorCode, json } from '../../../lib/http';

const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
  refresh: z.boolean().optional(),
});

export const POST: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = requestSchema.parse(await request.json());
    const sheet = await loadSheetForUser(userId, input.refresh === true);
    const query = new URLSearchParams(input.query.replace(/^\?/, ''));
    const snapshot = buildAnalyticsSnapshot(
      sheet.rows,
      filtersFromSearchParams(query),
    );
    const insights = await generateGroundedInsights(snapshot);
    return json({
      insights,
      context: {
        period: snapshot.period,
        rowCount: snapshot.rowCount,
        appliedFilters: filtersFromSearchParams(query),
        lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
        worksheetName: sheet.source.worksheetName,
      },
    });
  } catch (error) {
    const code = error instanceof z.ZodError ? 'INVALID_INPUT' : errorCode(error);
    const status = code === 'NO_DATA'
      ? 422
      : code === 'AI_NOT_CONFIGURED'
        ? 503
        : code === 'INVALID_INPUT' || code === 'INVALID_ORIGIN' || code === 'INVALID_CONTENT_TYPE'
          ? 400
          : code === 'NOT_CONNECTED'
            ? 409
            : 502;
    return json({ error: code }, status);
  }
};
