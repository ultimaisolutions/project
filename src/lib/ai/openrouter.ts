import { OpenRouter } from '@openrouter/sdk';
import type { ChatMessages } from '@openrouter/sdk/models';
import { z } from 'zod';
import { getServerEnv } from '../env';
import { AI_MODEL } from './model';

const DEFAULT_TIMEOUT_MS = 120_000;

type StructuredChatOptions<T> = {
  messages: ChatMessages[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  temperature: number;
};

function aiError(code: string) {
  return Object.assign(new Error(code), { code });
}

function errorCode(error: unknown) {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

export function isRetryableStructuredOutputError(error: unknown) {
  const code = errorCode(error);
  return code?.startsWith('AI_SCHEMA_') === true
    || code === 'AI_INVALID_JSON'
    || code === 'AI_EMPTY_RESPONSE'
    || code === 'AI_TRUNCATED_RESPONSE';
}

export async function withStructuredOutputRetry<T>(
  operation: (attempt: number) => Promise<T>,
  maxAttempts = 2,
) {
  const attemptLimit = Math.max(1, maxAttempts);
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const isLastAttempt = attempt === attemptLimit - 1;
      if (isLastAttempt || !isRetryableStructuredOutputError(error)) throw error;
    }
  }
  throw aiError('AI_INVALID_RESPONSE');
}

function schemaMismatchCode(issue: z.core.$ZodIssue) {
  const fieldPath = issue.path
    .filter((part): part is string => typeof part === 'string')
    .join('_');
  const suffix = fieldPath
    ? `_${fieldPath.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}`
    : '';
  return `AI_SCHEMA_${issue.code.toUpperCase()}${suffix}`;
}

export function buildStructuredChatRequest<T>({
  messages,
  schema,
  schemaName,
  maxTokens,
  temperature,
}: StructuredChatOptions<T>) {
  return {
    chatRequest: {
      model: AI_MODEL,
      messages,
      stream: false as const,
      maxTokens,
      temperature,
      provider: {
        requireParameters: true,
        sort: 'latency' as const,
      },
      reasoning: {
        effort: 'none' as const,
      },
      responseFormat: {
        type: 'json_schema' as const,
        jsonSchema: {
          name: schemaName,
          strict: true,
          schema: z.toJSONSchema(schema),
        },
      },
    },
  };
}

export function parseStructuredChatContent<T>(
  content: unknown,
  schema: z.ZodType<T>,
) {
  if (typeof content !== 'string' || content.trim() === '') {
    throw aiError('AI_EMPTY_RESPONSE');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw aiError('AI_INVALID_JSON');
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw aiError(schemaMismatchCode(validated.error.issues[0]));
  }
  return validated.data;
}

export function parseStructuredChatChoice<T>(
  choice: {
    finishReason?: string | null;
    message?: { content?: unknown };
  } | undefined,
  schema: z.ZodType<T>,
) {
  if (choice?.finishReason === 'length') {
    throw aiError('AI_TRUNCATED_RESPONSE');
  }
  return parseStructuredChatContent(choice?.message?.content, schema);
}

export function openRouterClient() {
  const apiKey = getServerEnv('OPENROUTER_API_KEY');
  if (!apiKey) throw aiError('AI_NOT_CONFIGURED');

  return new OpenRouter({
    apiKey,
    appTitle: 'STSICONIC',
    httpReferer: getServerEnv('PUBLIC_SITE_URL')
      ?? (getServerEnv('VERCEL_PROJECT_PRODUCTION_URL')
        ? `https://${getServerEnv('VERCEL_PROJECT_PRODUCTION_URL')}`
        : undefined),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
}

export function structuredOutputRequestOptions() {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: { strategy: 'none' as const },
  };
}

export async function generateStructuredObject<T>(
  options: StructuredChatOptions<T>,
) {
  const result = await openRouterClient().chat.send(
    buildStructuredChatRequest(options),
    structuredOutputRequestOptions(),
  );
  if (!('choices' in result)) throw aiError('AI_INVALID_RESPONSE');
  return parseStructuredChatChoice(result.choices[0], options.schema);
}
