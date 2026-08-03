import type { APIRoute } from 'astro';
import { z } from 'zod';
import {
  filtersFromSearchParams,
  loadSheetForUser,
} from '../../../lib/analytics';
import { createAnalyticsAgent } from '../../../lib/ai/agent';
import { buildAnalyticsSnapshot } from '../../../lib/ai/grounding';
import { getImageAsset } from '../../../lib/ai/image';
import {
  acceptsNdjson,
  assertJson,
  errorCode,
  json,
  ndjson,
} from '../../../lib/http';

const messageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2_000),
});
const requestSchema = z.object({
  query: z.string().max(4_000).default(''),
  messages: z.array(messageSchema).min(1).max(20),
});

type AgentStep = {
  toolResults: Array<{ toolName: string; output: unknown }>;
};

type QuestionAgent = {
  generate: (options: {
    messages: z.infer<typeof requestSchema>['messages'];
    abortSignal?: AbortSignal;
    timeout: { totalMs: number };
  }) => PromiseLike<{ text: string; steps: AgentStep[] }>;
  stream: (options: {
    messages: z.infer<typeof requestSchema>['messages'];
    abortSignal?: AbortSignal;
    timeout: { totalMs: number };
  }) => PromiseLike<{
    stream: AsyncIterable<unknown>;
    text: PromiseLike<string>;
    steps: PromiseLike<AgentStep[]>;
  }>;
};

type QuestionsRouteDependencies = {
  loadSheetForUser: typeof loadSheetForUser;
  createAnalyticsAgent: (
    ...args: Parameters<typeof createAnalyticsAgent>
  ) => QuestionAgent;
  getImageAsset: typeof getImageAsset;
};

const defaultDependencies: QuestionsRouteDependencies = {
  loadSheetForUser,
  createAnalyticsAgent: (snapshot, userId) => (
    createAnalyticsAgent(snapshot, userId) as unknown as QuestionAgent
  ),
  getImageAsset,
};

/** Builds the authenticated questions handler with injectable upstream boundaries. */
export const createQuestionsPost = (
  dependencies: QuestionsRouteDependencies = defaultDependencies,
): APIRoute => async ({ locals, request }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    assertJson(request);
    const input = requestSchema.parse(await request.json());
    if (input.messages.at(-1)?.role !== 'user') {
      throw Object.assign(new Error('INVALID_INPUT'), { code: 'INVALID_INPUT' });
    }
    const generate = async (
      signal: AbortSignal,
      onTextDelta?: (text: string) => void,
    ) => {
      const query = new URLSearchParams(input.query.replace(/^\?/, ''));
      const sheet = await dependencies.loadSheetForUser(userId);
      signal.throwIfAborted();
      const snapshot = buildAnalyticsSnapshot(
        sheet.rows,
        filtersFromSearchParams(query),
      );
      if (snapshot.rowCount === 0) {
        throw Object.assign(new Error('NO_DATA'), { code: 'NO_DATA' });
      }

      const agent = dependencies.createAnalyticsAgent(snapshot, userId);
      let answer: string;
      let steps: AgentStep[];
      if (onTextDelta) {
        const result = await agent.stream({
          messages: input.messages,
          abortSignal: signal,
          timeout: { totalMs: 75_000 },
        });
        for await (const value of result.stream) {
          signal.throwIfAborted();
          if (!value || typeof value !== 'object' || !('type' in value)) continue;
          const part = value as Record<string, unknown>;
          if (part.type === 'text-delta' && typeof part.text === 'string') {
            onTextDelta(part.text);
          }
          if (part.type === 'error') throw part.error;
          if (part.type === 'abort') {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
        }
        [answer, steps] = await Promise.all([result.text, result.steps]);
      } else {
        const result = await agent.generate({
          messages: input.messages,
          abortSignal: signal,
          timeout: { totalMs: 75_000 },
        });
        answer = result.text;
        steps = result.steps;
      }

      if (!answer.trim()) {
        throw Object.assign(new Error('AI_EMPTY_RESPONSE'), {
          code: 'AI_EMPTY_RESPONSE',
        });
      }
      const toolEvidence = steps.flatMap((step) => step.toolResults.map((toolResult) => ({
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
        const image = dependencies.getImageAsset(userId, item.output.assetId);
        return image ? [{ assetId: item.output.assetId, ...image }] : [];
      });

      return {
        answer,
        evidence: toolEvidence,
        images,
        context: {
          period: snapshot.period,
          rowCount: snapshot.rowCount,
          lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
        },
      };
    };

    if (acceptsNdjson(request)) {
      return ndjson(request, ({ signal, text }) => generate(signal, text));
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

export const POST = createQuestionsPost();
