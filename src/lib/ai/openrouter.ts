import { OpenRouter } from '@openrouter/sdk';
import type { ChatMessages } from '@openrouter/sdk/models';
import { z } from 'zod';
import { getServerEnv } from '../env';
import { AI_MODEL } from './model';

const DEFAULT_TIMEOUT_MS = 120_000;
export const INSIGHTS_MAX_TOKENS = 8_192;

type StructuredChatOptions<T> = {
  messages: ChatMessages[];
  schema: z.ZodType<T>;
  schemaName: string;
  maxTokens: number;
  temperature: number;
  route?: string;
  attempt?: number;
  signal?: AbortSignal;
  onProgress?: (stage: StructuredGenerationStage) => void;
};

type StructuredChatChunk = {
  model?: string;
  error?: unknown;
  openrouterMetadata?: {
    attempts?: Array<{
      model: string;
      provider: string;
      status: number;
    }>;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    completionTokensDetails?: {
      reasoningTokens?: number | null;
    } | null;
  };
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoningDetails?: unknown;
    };
    finishReason?: string | null;
  }>;
};

export type StructuredGenerationStage = 'generating' | 'retrying';

export type StructuredStreamDiagnostic = {
  model?: string;
  providerMetadata?: {
    model: string;
    provider: string;
    status: number;
  };
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  reasoningTokens?: number;
};

type StructuredAttemptDiagnostic = StructuredStreamDiagnostic & {
  route: string;
  model: string;
  attempt: number;
  durationMs: number;
};

type StructuredOutputDependencies = {
  send?: (
    request: ReturnType<typeof buildStructuredChatRequest>,
    options: ReturnType<typeof structuredOutputRequestOptions>,
  ) => Promise<AsyncIterable<StructuredChatChunk>>;
  now?: () => number;
  log?: (diagnostic: StructuredAttemptDiagnostic) => void;
};

type StructuredStreamOptions = {
  signal?: AbortSignal;
  onProgress?: (stage: StructuredGenerationStage) => void;
  onDiagnostic?: (diagnostic: StructuredStreamDiagnostic) => void;
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

function isAsyncIterable(value: unknown): value is AsyncIterable<StructuredChatChunk> {
  return typeof value === 'object'
    && value !== null
    && Symbol.asyncIterator in value;
}

export function isRetryableStructuredOutputError(error: unknown) {
  const code = errorCode(error);
  return code?.startsWith('AI_SCHEMA_') === true
    || code === 'AI_INVALID_JSON';
}

export async function withStructuredOutputRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: Pick<StructuredStreamOptions, 'onProgress'> = {},
) {
  const attemptLimit = 2;
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      const isLastAttempt = attempt === attemptLimit - 1;
      if (isLastAttempt || !isRetryableStructuredOutputError(error)) throw error;
      options.onProgress?.('retrying');
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
      stream: true as const,
      maxTokens,
      temperature,
      provider: {
        requireParameters: true,
        sort: 'throughput' as const,
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

export async function consumeStructuredChatStream<T>(
  chunks: AsyncIterable<StructuredChatChunk>,
  schema: z.ZodType<T>,
  options: StructuredStreamOptions = {},
) {
  let content = '';
  let finishReason: string | null | undefined;
  const diagnostic: StructuredStreamDiagnostic = {};
  try {
    options.signal?.throwIfAborted();
    for await (const chunk of chunks) {
      options.signal?.throwIfAborted();
      if (typeof chunk.model === 'string') diagnostic.model = chunk.model;
      const providerAttempt = chunk.openrouterMetadata?.attempts?.at(-1);
      if (providerAttempt) diagnostic.providerMetadata = {
        model: providerAttempt.model,
        provider: providerAttempt.provider,
        status: providerAttempt.status,
      };
      if (chunk.usage) {
        diagnostic.promptTokens = chunk.usage.promptTokens;
        diagnostic.completionTokens = chunk.usage.completionTokens;
        const reasoningTokens = chunk.usage.completionTokensDetails?.reasoningTokens;
        if (typeof reasoningTokens === 'number') {
          diagnostic.reasoningTokens = reasoningTokens;
        }
      }
      if (chunk.error) throw aiError('UPSTREAM_ERROR');
      const choice = chunk.choices?.[0];
      if (typeof choice?.delta?.content === 'string'
        && choice.delta.content.length > 0) {
        content += choice.delta.content;
        options.onProgress?.('generating');
        options.signal?.throwIfAborted();
      }
      if (choice?.finishReason) {
        finishReason = choice.finishReason;
        diagnostic.finishReason = choice.finishReason;
      }
    }
    return parseStructuredChatChoice({
      finishReason,
      message: { content },
    }, schema);
  } finally {
    options.onDiagnostic?.(diagnostic);
  }
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

export function structuredOutputRequestOptions(signal?: AbortSignal) {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    retries: { strategy: 'none' as const },
    signal,
  };
}

export async function generateStructuredObject<T>(
  options: StructuredChatOptions<T>,
  dependencies: StructuredOutputDependencies = {},
) {
  const now = dependencies.now ?? Date.now;
  const log = dependencies.log ?? ((diagnostic) => console.info(diagnostic));
  const startedAt = now();
  let streamStarted = false;
  let streamDiagnostic: StructuredStreamDiagnostic = {};
  try {
    options.signal?.throwIfAborted();
    const request = {
      ...buildStructuredChatRequest(options),
      xOpenRouterMetadata: 'enabled' as const,
    };
    const requestOptions = structuredOutputRequestOptions(options.signal);
    const chunks = dependencies.send
      ? await dependencies.send(request, requestOptions)
      : await openRouterClient().chat.send(request, requestOptions);
    streamStarted = true;
    if (!isAsyncIterable(chunks)) {
      throw aiError('AI_INVALID_RESPONSE');
    }
    return await consumeStructuredChatStream(chunks, options.schema, {
      signal: options.signal,
      onProgress: options.onProgress,
      onDiagnostic: (diagnostic) => { streamDiagnostic = diagnostic; },
    });
  } catch (error) {
    if (!streamStarted) {
      if (options.signal?.aborted) options.signal.throwIfAborted();
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (errorCode(error) === 'AI_NOT_CONFIGURED') throw error;
      throw aiError('UPSTREAM_ERROR');
    }
    throw error;
  } finally {
    log({
      route: options.route ?? 'structured-output',
      model: streamDiagnostic.model ?? AI_MODEL,
      providerMetadata: streamDiagnostic.providerMetadata,
      attempt: options.attempt ?? 0,
      finishReason: streamDiagnostic.finishReason,
      promptTokens: streamDiagnostic.promptTokens,
      completionTokens: streamDiagnostic.completionTokens,
      reasoningTokens: streamDiagnostic.reasoningTokens,
      durationMs: Math.max(0, now() - startedAt),
    });
  }
}
