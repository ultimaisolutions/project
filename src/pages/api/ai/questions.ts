import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  filtersFromSearchParams,
  loadSheetForUser,
} from '../../../lib/analytics';
import { createAnalyticsAgent } from '../../../lib/ai/agent';
import { buildAnalyticsSnapshot } from '../../../lib/ai/grounding';
import { getImageAsset } from '../../../lib/ai/image';
import { assertJson, errorCode, json } from '../../../lib/http';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2_000),
});
const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
  messages: z.array(messageSchema).min(1).max(20),
});

export const POST: APIRoute = async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = requestSchema.parse(await request.json());
    if (input.messages.at(-1)?.role !== 'user') {
      throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
    }
    const query = new URLSearchParams(input.query.replace(/^\?/, ''));
    const sheet = await loadSheetForUser(userId);
    const snapshot = buildAnalyticsSnapshot(
      sheet.rows,
      filtersFromSearchParams(query),
    );
    if (snapshot.rowCount === 0) {
      throw Object.assign(new Error('NO_DATA'), { code: 'NO_DATA' });
    }

    const agent = createAnalyticsAgent(snapshot, userId);
    const result = await agent.generate({
      messages: input.messages,
      timeout: { totalMs: 75_000 },
    });
    if (!result.text.trim()) {
      throw Object.assign(new Error('AI_EMPTY_RESPONSE'), {
        code: 'AI_EMPTY_RESPONSE',
      });
    }
    const toolEvidence = result.steps.flatMap((step) => step.toolResults.map((toolResult) => ({
      toolName: toolResult.toolName,
      output: toolResult.output,
    })));
    const images = toolEvidence.flatMap((item) => {
      if (
        typeof item.output !== 'object'
        || item.output === null
        || !('assetId' in item.output)
        || typeof item.output.assetId !== 'string'
      ) return [];
      const image = getImageAsset(userId, item.output.assetId);
      return image ? [{ assetId: item.output.assetId, ...image }] : [];
    });

    return json({
      answer: result.text,
      evidence: toolEvidence,
      images,
      context: {
        period: snapshot.period,
        rowCount: snapshot.rowCount,
        lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
      },
    });
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
