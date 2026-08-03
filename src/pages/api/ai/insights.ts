import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  filtersFromSearchParams,
  loadSheetForUser,
} from '../../../lib/analytics';
import { buildAnalyticsSnapshot } from '../../../lib/ai/grounding';
import { generateGroundedInsights } from '../../../lib/ai/insights';
import {
  acceptsNdjson,
  assertJson,
  errorCode,
  json,
  ndjson,
} from '../../../lib/http';

const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
  refresh: z.boolean().optional(),
});

type InsightsRouteDependencies = {
  loadSheetForUser: typeof loadSheetForUser;
  generateGroundedInsights: typeof generateGroundedInsights;
};

const defaultDependencies: InsightsRouteDependencies = {
  loadSheetForUser,
  generateGroundedInsights,
};

/** Builds the authenticated insights handler with injectable upstream boundaries. */
export const createInsightsPost = (
  dependencies: InsightsRouteDependencies = defaultDependencies,
): APIRoute => async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = requestSchema.parse(await request.json());
    const generate = async (
      signal: AbortSignal,
      onProgress?: NonNullable<Parameters<typeof generateGroundedInsights>[1]>['onProgress'],
    ) => {
      const sheet = await dependencies.loadSheetForUser(userId, input.refresh === true);
      signal.throwIfAborted();
      const query = new URLSearchParams(input.query.replace(/^\?/, ''));
      const filters = filtersFromSearchParams(query);
      const snapshot = buildAnalyticsSnapshot(sheet.rows, filters);
      const insights = await dependencies.generateGroundedInsights(snapshot, {
        signal,
        onProgress,
        route: 'insights',
      });
      return {
        insights,
        context: {
          period: snapshot.period,
          rowCount: snapshot.rowCount,
          appliedFilters: filters,
          lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
          worksheetName: sheet.source.worksheetName,
        },
      };
    };

    if (acceptsNdjson(request)) {
      return ndjson(request, async ({ signal, progress }) => {
        progress('loading-data');
        const result = await generate(signal, progress);
        progress('validating');
        return result;
      });
    }

    return json(await generate(request.signal));
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

export const POST = createInsightsPost();
