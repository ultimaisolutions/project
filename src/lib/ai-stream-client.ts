import type { AiProgressStage, AiStreamEvent } from './http';

export type { AiProgressStage } from './http';

const progressStages = new Set<AiProgressStage>([
  'loading-data',
  'generating',
  'validating',
  'retrying',
]);

export const aiProgressLabels: Record<AiProgressStage, string> = {
  'loading-data': 'טוען ומסכם את הנתונים…',
  generating: 'DeepSeek מנתח את הביצועים…',
  validating: 'מאמת את התובנות מול הנתונים…',
  retrying: 'מחדד את התוצאה…',
};

type StreamOptions = {
  signal?: AbortSignal;
  onProgress?: (stage: AiProgressStage) => void;
};

type FetchOptions = StreamOptions & {
  fetcher?: typeof fetch;
};

function symbolicCode(value: unknown) {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)
    ? value
    : 'UPSTREAM_ERROR';
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

function parseEvent(value: unknown): AiStreamEvent<unknown> | null {
  if (!value || typeof value !== 'object' || !('type' in value)) return null;
  const event = value as Record<string, unknown>;
  if (event.type === 'progress' && progressStages.has(event.stage as AiProgressStage)) {
    return { type: 'progress', stage: event.stage as AiProgressStage };
  }
  if (event.type === 'result' && 'data' in event) {
    return { type: 'result', data: event.data };
  }
  if (event.type === 'error') {
    return { type: 'error', error: symbolicCode(event.error) };
  }
  return null;
}

async function readJsonFallback<T>(response: Response, signal?: AbortSignal) {
  if (signal?.aborted) throw abortReason(signal);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error('UPSTREAM_ERROR');
  }
  if (signal?.aborted) throw abortReason(signal);
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body
      ? (body as { error: unknown }).error
      : undefined;
    throw new Error(symbolicCode(error));
  }
  return body as T;
}

/** Reads a negotiated AI response without ever exposing provider text chunks. */
export async function readAiStream<T>(
  response: Response,
  options: StreamOptions = {},
): Promise<T> {
  const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/x-ndjson') {
    return readJsonFallback<T>(response, options.signal);
  }
  if (!response.body) throw new Error('UPSTREAM_ERROR');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  let hasResult = false;
  let result: T | undefined;
  const cancel = () => { void reader.cancel(options.signal?.reason).catch(() => undefined); };

  if (options.signal?.aborted) cancel();
  else options.signal?.addEventListener('abort', cancel, { once: true });

  const consumeLine = (line: string) => {
    if (!line.trim()) return;
    let decoded: unknown;
    try {
      decoded = JSON.parse(line);
    } catch {
      throw new Error('UPSTREAM_ERROR');
    }
    const event = parseEvent(decoded);
    if (!event) return;
    if (event.type === 'progress') options.onProgress?.(event.stage);
    if (event.type === 'error') throw new Error(event.error);
    if (event.type === 'result') {
      hasResult = true;
      result = event.data as T;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split('\n');
      buffered = lines.pop() ?? '';
      for (const line of lines) consumeLine(line);
    }
    buffered += decoder.decode();
    consumeLine(buffered);
    if (options.signal?.aborted) throw abortReason(options.signal);
    if (!hasResult) throw new Error('UPSTREAM_ERROR');
    return result as T;
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Posts an AI request using the negotiated streaming transport and JSON fallback. */
export async function fetchAiGeneration<T>(
  path: string,
  body: unknown,
  options: FetchOptions = {},
) {
  const response = await (options.fetcher ?? fetch)(path, {
    method: 'POST',
    headers: {
      accept: 'application/x-ndjson',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  return readAiStream<T>(response, options);
}
