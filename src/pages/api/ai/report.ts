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
import { buildManagementReport } from '../../../lib/report';

const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
});

type ReportRouteDependencies = {
  loadSheetForUser: typeof loadSheetForUser;
  generateGroundedInsights: typeof generateGroundedInsights;
  now: () => Date;
};

const defaultDependencies: ReportRouteDependencies = {
  loadSheetForUser,
  generateGroundedInsights,
  now: () => new Date(),
};

/** Builds the authenticated report handler with injectable upstream boundaries. */
export const createReportPost = (
  dependencies: ReportRouteDependencies = defaultDependencies,
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
      const query = new URLSearchParams(input.query.replace(/^\?/, ''));
      const sheet = await dependencies.loadSheetForUser(userId);
      signal.throwIfAborted();
      const snapshot = buildAnalyticsSnapshot(
        sheet.rows,
        filtersFromSearchParams(query),
      );
      const insights = await dependencies.generateGroundedInsights(snapshot, {
        signal,
        onProgress,
        route: 'report',
      });
      const report = buildManagementReport(
        snapshot,
        insights,
        sheet.source.worksheetName,
      );
      return {
        report,
        evidence: insights.evidence,
        generatedAt: dependencies.now().toISOString(),
        lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
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
    const status = code === 'INVALID_INPUT' || code === 'INVALID_ORIGIN' || code === 'INVALID_CONTENT_TYPE'
      ? 400
      : code === 'NO_DATA'
        ? 422
        : code === 'NOT_CONNECTED'
          ? 409
          : code === 'AI_NOT_CONFIGURED'
            ? 503
            : 502;
    return json({ error: code }, status);
  }
};

export const POST = createReportPost();
