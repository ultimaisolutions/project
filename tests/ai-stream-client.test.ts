import { describe, expect, test } from 'bun:test';
import {
  fetchAiGeneration,
  readAiStream,
} from '../src/lib/ai-stream-client';

const encoder = new TextEncoder();

function responseFromBytes(bytes: Uint8Array, chunkSizes: number[]) {
  let offset = 0;
  let chunkIndex = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const size = chunkSizes[chunkIndex] ?? 1;
      chunkIndex += 1;
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  }), {
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
  });
}

describe('AI NDJSON browser client', () => {
  test('parses Hebrew events across arbitrary byte boundaries and ignores unknown events', async () => {
    const bytes = encoder.encode([
      JSON.stringify({ type: 'progress', stage: 'loading-data' }),
      JSON.stringify({ type: 'text-delta', text: 'תשובה ' }),
      JSON.stringify({ type: 'future-pulse', detail: 'לא להצגה' }),
      JSON.stringify({ type: 'text-delta', text: 'מדורגת 📊' }),
      JSON.stringify({ type: 'progress', stage: 'generating' }),
      JSON.stringify({ type: 'result', data: { summary: 'תוצאה סופית 📊' } }),
      '',
    ].join('\n'));
    const stages: string[] = [];
    const textDeltas: string[] = [];

    const result = await readAiStream<{ summary: string }>(
      responseFromBytes(bytes, [1, 2, 3, 1, 7, 2, 1, 4, 1, 9]),
      {
        onProgress: (stage) => stages.push(stage),
        onTextDelta: (text) => textDeltas.push(text),
      },
    );

    expect(stages).toEqual(['loading-data', 'generating']);
    expect(textDeltas).toEqual(['תשובה ', 'מדורגת 📊']);
    expect(result).toEqual({ summary: 'תוצאה סופית 📊' });
  });

  test('surfaces only the streamed symbolic error code', async () => {
    const bytes = encoder.encode([
      JSON.stringify({ type: 'progress', stage: 'validating' }),
      JSON.stringify({ type: 'error', error: 'AI_INVALID_EVIDENCE' }),
      '',
    ].join('\n'));

    let failure: unknown;
    try {
      await readAiStream(responseFromBytes(bytes, [2, 1, 1, 3, 5]));
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('AI_INVALID_EVIDENCE');
  });

  test('cancels the response reader after a protocol error', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{invalid-json}\n'));
      },
      cancel() {
        cancelled = true;
      },
    }), {
      headers: { 'content-type': 'application/x-ndjson' },
    });

    let failure: unknown;
    try {
      await readAiStream(response);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('UPSTREAM_ERROR');
    expect(cancelled).toBe(true);
  });

  test('cancels the response reader while preserving a progress callback exception', async () => {
    let cancelled = false;
    const callbackFailure = new Error('render failed');
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(
          '{"type":"progress","stage":"generating"}\n',
        ));
      },
      cancel() {
        cancelled = true;
      },
    }), {
      headers: { 'content-type': 'application/x-ndjson' },
    });

    let failure: unknown;
    try {
      await readAiStream(response, {
        onProgress: () => { throw callbackFailure; },
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(callbackFailure);
    expect(cancelled).toBe(true);
  });

  test('cancels the response reader when its request signal is aborted', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"progress","stage":"loading-data"}\n'));
      },
      cancel() {
        cancelled = true;
      },
    }), {
      headers: { 'content-type': 'application/x-ndjson' },
    });
    const abort = new AbortController();
    const reading = readAiStream(response, { signal: abort.signal });

    abort.abort();

    let failure: unknown;
    try {
      await reading;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('AbortError');
    expect(cancelled).toBe(true);
  });

  test('negotiates NDJSON and preserves a successful JSON fallback', async () => {
    let request: { input: RequestInfo | URL; init?: RequestInit } | undefined;
    const fetcher: typeof fetch = Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        request = { input, init };
        return new Response(JSON.stringify({ summary: 'JSON fallback' }), {
          headers: { 'content-type': 'application/json' },
        });
      },
      { preconnect: fetch.preconnect },
    );

    const result = await fetchAiGeneration<{ summary: string }>(
      '/api/ai/insights',
      { query: '?channel=Google' },
      { fetcher },
    );

    expect(request?.input).toBe('/api/ai/insights');
    expect(request?.init).toMatchObject({ method: 'POST' });
    expect(new Headers(request?.init?.headers).get('accept')).toBe('application/x-ndjson');
    expect(result).toEqual({ summary: 'JSON fallback' });
  });

  test('preserves an arbitrary abort reason when JSON fallback decoding is interrupted', async () => {
    const abort = new AbortController();
    const reason = { source: 'navigation', detail: 'decoding interrupted' };
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(encoder.encode('{"summary":'));
      },
    }), {
      headers: { 'content-type': 'application/json' },
    });
    const reading = readAiStream(response, { signal: abort.signal });

    await Promise.resolve();
    abort.abort(reason);
    bodyController.error(new Error('body transport interrupted'));

    let failure: unknown;
    try {
      await reading;
    } catch (error) {
      failure = error;
    }

    expect(failure).toBe(reason);
  });
});
