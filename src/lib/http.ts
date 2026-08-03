import type { Timings } from './timing';

export type AiProgressStage = 'loading-data' | 'generating' | 'validating' | 'retrying';

export type AiStreamEvent<T> =
  | { type: 'progress'; stage: AiProgressStage }
  | { type: 'result'; data: T }
  | { type: 'error'; error: string };

const textEncoder = new TextEncoder();

/** Encodes one complete NDJSON event as a UTF-8 line. */
export function encodeNdjsonEvent<T>(event: AiStreamEvent<T>) {
  return textEncoder.encode(`${JSON.stringify(event)}\n`);
}

type AiStreamWriter = {
  signal: AbortSignal;
  progress: (stage: AiProgressStage) => void;
};

/** Returns whether a request explicitly negotiated the NDJSON media type. */
export function acceptsNdjson(request: Request) {
  return request.headers.get('accept')?.split(',').some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(';');
    if (mediaType !== 'application/x-ndjson') return false;
    const qualityParameter = parameters.find((parameter) => (
      parameter.trim().startsWith('q=')
    ));
    if (!qualityParameter) return true;
    const quality = Number(qualityParameter.trim().slice(2));
    return Number.isFinite(quality) && quality > 0;
  }) ?? false;
}

/**
 * Runs an AI operation in an abort-aware NDJSON response. Request aborts and
 * response cancellation stop downstream work, and terminal events are emitted
 * only while the stream remains writable.
 */
export function ndjson<T>(
  request: Request,
  operation: (writer: AiStreamWriter) => Promise<T>,
) {
  const downstream = new AbortController();
  let cancelled = false;
  let closed = false;
  const abortFromRequest = () => downstream.abort(request.signal.reason);

  if (request.signal.aborted) {
    abortFromRequest();
  } else {
    request.signal.addEventListener('abort', abortFromRequest, { once: true });
  }

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const cleanup = () => {
        request.signal.removeEventListener('abort', abortFromRequest);
      };
      const emit = (event: AiStreamEvent<T>) => {
        if (cancelled || closed || downstream.signal.aborted) return false;
        try {
          controller.enqueue(encodeNdjsonEvent(event));
          return true;
        } catch {
          cancelled = true;
          downstream.abort();
          cleanup();
          return false;
        }
      };
      const finish = () => {
        cleanup();
        if (cancelled || closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          downstream.abort();
        }
      };

      void Promise.resolve().then(async () => {
        try {
          if (downstream.signal.aborted) return;
          const result = await operation({
            signal: downstream.signal,
            progress: (stage) => { emit({ type: 'progress', stage }); },
          });
          emit({ type: 'result', data: result });
        } catch (error) {
          if (!downstream.signal.aborted) {
            emit({ type: 'error', error: errorCode(error) });
          }
        } finally {
          finish();
        }
      });
    },
    cancel(reason) {
      cancelled = true;
      request.signal.removeEventListener('abort', abortFromRequest);
      if (!downstream.signal.aborted) downstream.abort(reason);
    },
  });

  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** Creates a non-cacheable JSON response with security and optional timing headers. */
export const json = (data: unknown, status = 200, timings?: Timings) => new Response(
  JSON.stringify(data),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(timings?.header() ? { 'server-timing': timings.header() as string } : {}),
    },
  },
);

/** Returns a safe public error code, replacing unknown or malformed codes. */
export const errorCode = (error: unknown) => (
  typeof error === 'object'
  && error
  && 'code' in error
  && typeof error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'UPSTREAM_ERROR'
);

/** Rejects cross-origin or non-JSON requests before a JSON endpoint reads its body. */
export function assertJson(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw Object.assign(new Error('INVALID_ORIGIN'), {
      code: 'INVALID_ORIGIN',
    });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw Object.assign(new Error('INVALID_CONTENT_TYPE'), {
      code: 'INVALID_CONTENT_TYPE',
    });
  }
}
