import { describe, expect, test } from 'bun:test';
import type { APIRoute } from 'astro';
import {
  acceptsNdjson,
  encodeNdjsonEvent,
  ndjson,
} from '../src/lib/http';
import { generateGroundedInsights } from '../src/lib/ai/insights';
import { readAiStream } from '../src/lib/ai-stream-client';
import { createInsightsPost } from '../src/pages/api/ai/insights';
import { createQuestionsPost } from '../src/pages/api/ai/questions';
import { createReportPost } from '../src/pages/api/ai/report';
import type { SheetRow } from '../src/lib/sheets';

const row: SheetRow = {
  id: 'R1',
  date: '2026-07-05',
  campaign: 'קיץ',
  channel: 'Google',
  budget: 1_200,
  actualSpend: 1_000,
  impressions: 10_000,
  clicks: 300,
  leads: 20,
  meetings: 8,
  deals: 4,
  revenue: 8_000,
  salesperson: 'דנה',
  region: 'מרכז',
  product: 'ייעוץ',
};

const sheet = {
  rows: [row],
  skippedRows: 0,
  warnings: [],
  lastSyncAt: new Date('2026-08-03T08:30:00.000Z'),
  source: {
    spreadsheetId: 'sheet-private-id',
    worksheetName: 'נתונים',
  },
};

const generatedInsights: Awaited<ReturnType<typeof generateGroundedInsights>> = {
  summary: 'הביצועים מצביעים על מגמה חיובית.',
  insights: [
    {
      title: 'תובנה ראשונה',
      explanation: 'ההכנסות מציגות ביצועים חזקים.',
      evidenceKeys: ['kpi.revenue.current'],
    },
    {
      title: 'תובנה שנייה',
      explanation: 'הקמפיין המוביל תומך בתוצאה.',
      evidenceKeys: ['leader.campaign'],
    },
    {
      title: 'תובנה שלישית',
      explanation: 'הערוץ המוביל מרכז את הפעילות.',
      evidenceKeys: ['leader.channel'],
    },
  ],
  trends: [],
  anomalies: [],
  exceptionalPerformers: [],
  recommendations: [
    'להמשיך לעקוב אחר הביצועים.',
    'לבחון את איכות הלידים.',
    'להשוות בין ערוצים.',
  ],
  investigate: ['לבדוק את מקורות השינוי.'],
  evidence: [
    {
      key: 'kpi.revenue.current',
      label: 'סך הכנסות בתקופה',
      value: 8_000,
      format: 'currency',
    },
  ],
};

function requestFor(
  path: 'insights' | 'report',
  accept = 'application/x-ndjson',
  signal?: AbortSignal,
) {
  return new Request(`http://localhost/api/ai/${path}`, {
    method: 'POST',
    headers: {
      accept,
      'content-type': 'application/json',
    },
    body: JSON.stringify(path === 'insights'
      ? { query: '?channel=Google', refresh: true }
      : { query: '?channel=Google' }),
    signal,
  });
}

function questionsRequest(
  accept = 'application/x-ndjson',
  signal?: AbortSignal,
) {
  return new Request('http://localhost/api/ai/questions', {
    method: 'POST',
    headers: {
      accept,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: '?channel=Google',
      messages: [{ role: 'user', content: 'מה מצב ההכנסות?' }],
    }),
    signal,
  });
}

async function invoke(handler: APIRoute, request: Request, userId = 'user_123') {
  return handler({
    locals: { auth: () => ({ userId }) },
    request,
  } as Parameters<APIRoute>[0]);
}

async function readEvents(response: Response) {
  const text = await response.text();
  expect(text.endsWith('\n')).toBe(true);
  return text.trimEnd().split('\n').map((line) => JSON.parse(line));
}

describe('NDJSON transport contract', () => {
  test('encodes one complete UTF-8 JSON line without exposing embedded newlines', () => {
    const encoded = encodeNdjsonEvent({
      type: 'result',
      data: { summary: 'שורה ראשונה\nשורה שנייה 📊' },
    });
    const line = new TextDecoder().decode(encoded);

    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({
      type: 'result',
      data: { summary: 'שורה ראשונה\nשורה שנייה 📊' },
    });
  });

  test('negotiates an accepted NDJSON media range but honors a zero quality value', () => {
    expect(acceptsNdjson(new Request('http://localhost', {
      headers: { accept: 'application/json, application/x-ndjson; q=0.8' },
    }))).toBe(true);
    expect(acceptsNdjson(new Request('http://localhost', {
      headers: { accept: 'application/x-ndjson; q=0.0, application/json' },
    }))).toBe(false);
  });

  test('closes without starting work when the request is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    let started = false;
    const response = ndjson(new Request('http://localhost', {
      signal: abort.signal,
    }), async () => {
      started = true;
      return { unreachable: true };
    });

    const read = await Promise.race([
      response.body?.getReader().read(),
      Bun.sleep(25).then(() => 'timed-out' as const),
    ]);

    expect(read).toEqual({ done: true, value: undefined });
    expect(started).toBe(false);
  });

  test('emits ordered text deltas before the terminal result', async () => {
    const response = ndjson(new Request('http://localhost'), async (writer) => {
      writer.text('תשובה ');
      writer.text('חלקית 📊');
      return { answer: 'תשובה חלקית 📊' };
    });

    expect(await readEvents(response)).toEqual([
      { type: 'text-delta', text: 'תשובה ' },
      { type: 'text-delta', text: 'חלקית 📊' },
      { type: 'result', data: { answer: 'תשובה חלקית 📊' } },
    ]);
  });
});

describe('negotiated AI route streaming', () => {
  test('streams only answer text before server-collected question metadata', async () => {
    const steps = [{
      toolResults: [{
        toolName: 'createMarketingImage',
        output: { assetId: 'asset-1', title: 'תמונת ביצועים' },
      }],
    }];
    const handler = createQuestionsPost({
      loadSheetForUser: async () => sheet,
      createAnalyticsAgent: () => ({
        generate: async () => { throw new Error('JSON path was not expected'); },
        stream: async () => ({
          stream: (async function* answerParts() {
            yield { type: 'reasoning-delta', text: 'private reasoning' };
            yield { type: 'tool-input-delta', delta: 'private tool input' };
            yield { type: 'text-delta', text: 'ההכנסות ' };
            yield { type: 'raw', rawValue: { provider: 'private metadata' } };
            yield { type: 'text-delta', text: '**חזקות**.' };
          })(),
          text: Promise.resolve('ההכנסות **חזקות**.'),
          steps: Promise.resolve(steps),
        }),
      }),
      getImageAsset: () => ({
        imageBase64: 'c2FmZS1pbWFnZQ==',
        mimeType: 'image/webp',
        prompt: 'Safe visual prompt',
        title: 'תמונת ביצועים',
      }),
    } as never);

    const response = await invoke(handler, questionsRequest());
    const raw = await response.text();
    const events = raw.trimEnd().split('\n').map((line) => JSON.parse(line));

    expect(events.map((event) => event.type)).toEqual([
      'text-delta',
      'text-delta',
      'result',
    ]);
    expect(events.slice(0, 2)).toEqual([
      { type: 'text-delta', text: 'ההכנסות ' },
      { type: 'text-delta', text: '**חזקות**.' },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'result',
      data: {
        answer: 'ההכנסות **חזקות**.',
        evidence: [{
          toolName: 'createMarketingImage',
          output: { assetId: 'asset-1', title: 'תמונת ביצועים' },
        }],
        images: [{
          assetId: 'asset-1',
          imageBase64: 'c2FmZS1pbWFnZQ==',
          mimeType: 'image/webp',
          prompt: 'Safe visual prompt',
          title: 'תמונת ביצועים',
        }],
        context: {
          period: { from: '2026-06-06', to: '2026-07-05' },
          rowCount: 1,
          lastSyncAt: '2026-08-03T08:30:00.000Z',
        },
      },
    });
    expect(raw).not.toContain('private reasoning');
    expect(raw).not.toContain('private tool input');
    expect(raw).not.toContain('private metadata');
  });

  test('preserves the existing questions JSON response for ordinary callers', async () => {
    const steps = [{
      toolResults: [{
        toolName: 'overview',
        output: { evidence: [{ key: 'kpi.revenue.current', value: 8_000 }] },
      }],
    }];
    const handler = createQuestionsPost({
      loadSheetForUser: async () => sheet,
      createAnalyticsAgent: () => ({
        generate: async () => ({ text: 'תשובה סופית', steps }),
        stream: async () => { throw new Error('stream path was not expected'); },
      }),
      getImageAsset: () => null,
    } as never);

    const response = await invoke(handler, questionsRequest('application/json'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      answer: 'תשובה סופית',
      evidence: [{
        toolName: 'overview',
        output: { evidence: [{ key: 'kpi.revenue.current', value: 8_000 }] },
      }],
      images: [],
      context: {
        period: { from: '2026-06-06', to: '2026-07-05' },
        rowCount: 1,
        lastSyncAt: '2026-08-03T08:30:00.000Z',
      },
    });
  });

  test('ends a failed question stream without emitting a result', async () => {
    const handler = createQuestionsPost({
      loadSheetForUser: async () => sheet,
      createAnalyticsAgent: () => ({
        generate: async () => { throw new Error('JSON path was not expected'); },
        stream: async () => ({
          stream: (async function* failedAnswer() {
            yield { type: 'text-delta', text: 'תשובה חלקית' };
            throw Object.assign(new Error('private provider failure'), {
              code: 'AI_UPSTREAM_FAILED',
            });
          })(),
          text: Promise.resolve('תשובה חלקית'),
          steps: Promise.resolve([]),
        }),
      }),
      getImageAsset: () => null,
    } as never);

    const response = await invoke(handler, questionsRequest());
    const raw = await response.text();
    const events = raw.trimEnd().split('\n').map((line) => JSON.parse(line));

    expect(events).toEqual([
      { type: 'text-delta', text: 'תשובה חלקית' },
      { type: 'error', error: 'AI_UPSTREAM_FAILED' },
    ]);
    expect(events.some((event) => event.type === 'result')).toBe(false);
    expect(raw).not.toContain('private provider failure');
  });

  test('aborts the questions agent when the browser cancels the stream', async () => {
    let agentSignal: AbortSignal | undefined;
    let agentStarted!: () => void;
    const started = new Promise<void>((resolve) => { agentStarted = resolve; });
    const handler = createQuestionsPost({
      loadSheetForUser: async () => sheet,
      createAnalyticsAgent: () => ({
        generate: async () => { throw new Error('JSON path was not expected'); },
        stream: async (options: { abortSignal?: AbortSignal }) => {
          agentSignal = options.abortSignal;
          agentStarted();
          return {
            stream: (async function* pendingAnswer() {
              await new Promise((_, reject) => agentSignal?.addEventListener('abort', () => {
                reject(agentSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
              }, { once: true }));
            })(),
            text: Promise.resolve(''),
            steps: Promise.resolve([]),
          };
        },
      }),
      getImageAsset: () => null,
    } as never);

    const response = await invoke(handler, questionsRequest());
    const reader = response.body?.getReader();
    await started;
    await reader?.cancel('new conversation');

    expect(agentSignal?.aborted).toBe(true);
  });

  test('streams insight progress, retry pulses, validation, and the existing result DTO', async () => {
    let loadedFor: unknown[] = [];
    let generationContext: Record<string, unknown> | undefined;
    const handler = createInsightsPost({
      loadSheetForUser: async (...args: unknown[]) => {
        loadedFor = args;
        return sheet;
      },
      generateGroundedInsights: async (_snapshot, context = {}) => {
        generationContext = context as Record<string, unknown>;
        context.onProgress?.('generating');
        context.onProgress?.('generating');
        context.onProgress?.('validating');
        context.onProgress?.('retrying');
        context.onProgress?.('generating');
        context.onProgress?.('validating');
        return generatedInsights;
      },
    });

    const response = await invoke(handler, requestFor('insights'));
    const events = await readEvents(response);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(loadedFor).toEqual(['user_123', true]);
    expect(generationContext).toMatchObject({ route: 'insights' });
    expect(generationContext?.signal).toBeInstanceOf(AbortSignal);
    expect(events).toEqual([
      { type: 'progress', stage: 'loading-data' },
      { type: 'progress', stage: 'generating' },
      { type: 'progress', stage: 'generating' },
      { type: 'progress', stage: 'validating' },
      { type: 'progress', stage: 'retrying' },
      { type: 'progress', stage: 'generating' },
      { type: 'progress', stage: 'validating' },
      {
        type: 'result',
        data: {
          insights: generatedInsights,
          context: {
            period: { from: '2026-06-06', to: '2026-07-05' },
            rowCount: 1,
            appliedFilters: {
              campaigns: [],
              channels: ['Google'],
              salespeople: [],
              regions: [],
              products: [],
            },
            lastSyncAt: '2026-08-03T08:30:00.000Z',
            worksheetName: 'נתונים',
          },
        },
      },
    ]);
  });

  test('streams real validation stages through a malformed-output retry to the client parser', async () => {
    const { evidence: _evidence, ...providerOutputWithoutTrend } = generatedInsights;
    const providerOutput = {
      ...providerOutputWithoutTrend,
      trends: [{
        title: 'מגמה מרכזית',
        explanation: 'ההכנסות מציגות מגמה חיובית.',
        evidenceKeys: ['kpi.revenue.current'],
      }],
    };
    let attempts = 0;
    const handler = createInsightsPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: (snapshot, context = {}) => generateGroundedInsights(
        snapshot,
        {
          ...context,
          providerDependencies: {
            send: async () => {
              attempts += 1;
              async function* chunks() {
                yield {
                  choices: [{
                    delta: {
                      content: attempts === 1
                        ? '{"summary":'
                        : JSON.stringify(providerOutput),
                    },
                    finishReason: 'stop',
                  }],
                };
              }
              return chunks();
            },
            now: () => 100,
            log: () => {},
          },
        },
      ),
    });
    const stages: string[] = [];

    const result = await readAiStream<{
      insights: typeof generatedInsights;
    }>(await invoke(handler, requestFor('insights')), {
      onProgress: (stage) => stages.push(stage),
    });

    expect(attempts).toBe(2);
    expect(stages).toEqual([
      'loading-data',
      'generating',
      'validating',
      'retrying',
      'generating',
      'validating',
    ]);
    expect(result.insights.summary).toBe(generatedInsights.summary);
  });

  test('keeps report generation separate and streams its existing report DTO', async () => {
    let route: unknown;
    const handler = createReportPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async (_snapshot, context = {}) => {
        route = context.route;
        context.onProgress?.('generating');
        context.onProgress?.('validating');
        return generatedInsights;
      },
      now: () => new Date('2026-08-03T09:45:00.000Z'),
    });

    const response = await invoke(handler, requestFor('report'));
    const events = await readEvents(response);
    const result = events.at(-1);

    expect(route).toBe('report');
    expect(events.map((event) => event.type === 'progress' ? event.stage : event.type))
      .toEqual(['loading-data', 'generating', 'validating', 'result']);
    expect(Object.keys(result.data).sort())
      .toEqual(['evidence', 'generatedAt', 'lastSyncAt', 'report']);
    expect(result.data).toMatchObject({
      report: {
        sourceName: 'נתונים',
        rowCount: 1,
        insights: generatedInsights,
      },
      evidence: generatedInsights.evidence,
      generatedAt: '2026-08-03T09:45:00.000Z',
      lastSyncAt: '2026-08-03T08:30:00.000Z',
    });
  });

  test('ends a failed stream with only the sanitized symbolic error code', async () => {
    const handler = createInsightsPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async (_snapshot, context = {}) => {
        context.onProgress?.('generating');
        throw Object.assign(new Error('private provider detail'), {
          code: 'AI_TRUNCATED_RESPONSE',
          secret: 'must-not-leak',
        });
      },
    });

    const response = await invoke(handler, requestFor('insights'));
    const text = await response.text();
    const events = text.trimEnd().split('\n').map((line) => JSON.parse(line));

    expect(events).toEqual([
      { type: 'progress', stage: 'loading-data' },
      { type: 'progress', stage: 'generating' },
      { type: 'error', error: 'AI_TRUNCATED_RESPONSE' },
    ]);
    expect(text).not.toContain('private provider detail');
    expect(text).not.toContain('must-not-leak');
  });

  test('preserves the insights JSON response body and status when NDJSON is not requested', async () => {
    const handler = createInsightsPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async () => generatedInsights,
    });

    const response = await invoke(handler, requestFor('insights', 'application/json'));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      insights: generatedInsights,
      context: {
        period: { from: '2026-06-06', to: '2026-07-05' },
        rowCount: 1,
        appliedFilters: {
          campaigns: [],
          channels: ['Google'],
          salespeople: [],
          regions: [],
          products: [],
        },
        lastSyncAt: '2026-08-03T08:30:00.000Z',
        worksheetName: 'נתונים',
      },
    });
  });

  test('preserves report JSON results and sanitized HTTP errors', async () => {
    const successHandler = createReportPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async () => generatedInsights,
      now: () => new Date('2026-08-03T09:45:00.000Z'),
    });
    const errorHandler = createReportPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async () => {
        throw Object.assign(new Error('secret'), { code: 'AI_NOT_CONFIGURED' });
      },
      now: () => new Date('2026-08-03T09:45:00.000Z'),
    });

    const success = await invoke(successHandler, requestFor('report', '*/*'));
    const failure = await invoke(errorHandler, requestFor('report', 'application/json'));
    const body = await success.json();

    expect(success.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['evidence', 'generatedAt', 'lastSyncAt', 'report']);
    expect(body).toMatchObject({
      report: { sourceName: 'נתונים', insights: generatedInsights },
      evidence: generatedInsights.evidence,
      generatedAt: '2026-08-03T09:45:00.000Z',
      lastSyncAt: '2026-08-03T08:30:00.000Z',
    });
    expect(failure.status).toBe(503);
    expect(await failure.json()).toEqual({ error: 'AI_NOT_CONFIGURED' });
  });

  test('aborts provider work when the response stream is cancelled', async () => {
    let providerSignal: AbortSignal | undefined;
    let generationStarted!: () => void;
    const started = new Promise<void>((resolve) => { generationStarted = resolve; });
    const handler = createInsightsPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async (_snapshot, context = {}) => {
        providerSignal = context.signal;
        generationStarted();
        await new Promise((_, reject) => context.signal?.addEventListener('abort', () => {
          reject(context.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true }));
        return generatedInsights;
      },
    });

    const response = await invoke(handler, requestFor('insights'));
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    expect(new TextDecoder().decode((await reader?.read())?.value))
      .toBe('{"type":"progress","stage":"loading-data"}\n');
    await started;

    await reader?.cancel('browser disconnected');

    expect(providerSignal?.aborted).toBe(true);
  });

  test('forwards request aborts into provider work without emitting a late error', async () => {
    const requestController = new AbortController();
    let providerSignal: AbortSignal | undefined;
    let generationStarted!: () => void;
    const started = new Promise<void>((resolve) => { generationStarted = resolve; });
    const handler = createInsightsPost({
      loadSheetForUser: async () => sheet,
      generateGroundedInsights: async (_snapshot, context = {}) => {
        providerSignal = context.signal;
        generationStarted();
        await new Promise((_, reject) => context.signal?.addEventListener('abort', () => {
          context.onProgress?.('generating');
          reject(context.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        }, { once: true }));
        return generatedInsights;
      },
    });

    const response = await invoke(
      handler,
      requestFor('insights', 'application/x-ndjson', requestController.signal),
    );
    const reader = response.body?.getReader();
    await reader?.read();
    await started;

    requestController.abort();
    const afterAbort = await reader?.read();

    expect(providerSignal?.aborted).toBe(true);
    expect(afterAbort?.done).toBe(true);
    expect(afterAbort?.value).toBeUndefined();
  });
});
