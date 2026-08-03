import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildStructuredChatRequest,
  consumeStructuredChatStream,
  generateStructuredObject,
  parseStructuredChatChoice,
  parseStructuredChatContent,
  structuredOutputRequestOptions,
  withStructuredOutputRetry,
} from '../src/lib/ai/openrouter';
import {
  insightsSchema,
  insightsSchemaForEvidenceKeys,
  validateInsightSemantics,
} from '../src/lib/ai/insights-schema';
import {
  insightEvidenceCatalog,
  type AnalyticsSnapshot,
  type DimensionMetrics,
} from '../src/lib/ai/grounding';
import { generateGroundedInsights } from '../src/lib/ai/insights';

describe('OpenRouter structured output adapter', () => {
  const schema = z.object({ ok: z.boolean() });

  test('validates JSON split across provider content chunks', async () => {
    async function* chunks() {
      yield { choices: [{ delta: { content: '{"o' }, finishReason: null }] };
      yield { choices: [{ delta: { content: 'k":true}' }, finishReason: 'stop' }] };
    }

    expect(await consumeStructuredChatStream(chunks(), schema)).toEqual({ ok: true });
  });

  test('emits content-only progress pulses and captures final safe metadata', async () => {
    const stages: string[] = [];
    let diagnostic: unknown;
    async function* chunks() {
      yield {
        model: 'test/model',
        choices: [{
          delta: { content: '{', reasoning: 'never expose this' },
          finishReason: null,
        }],
      };
      yield {
        choices: [{ delta: { reasoning: 'or this' }, finishReason: null }],
      };
      yield {
        choices: [{ delta: { content: '"ok":tr' }, finishReason: null }],
      };
      yield {
        openrouterMetadata: {
          attempts: [{ model: 'test/model', provider: 'test-provider', status: 200 }],
        },
        usage: {
          promptTokens: 12,
          completionTokens: 7,
          totalTokens: 19,
          completionTokensDetails: { reasoningTokens: 2 },
        },
        choices: [{ delta: { content: 'ue}' }, finishReason: 'stop' }],
      };
    }

    const result = await consumeStructuredChatStream(chunks(), schema, {
      onProgress: (stage: string) => stages.push(stage),
      onDiagnostic: (value: unknown) => { diagnostic = value; },
    });

    expect(result).toEqual({ ok: true });
    expect(stages).toEqual(['generating', 'generating', 'generating', 'validating']);
    expect(diagnostic).toEqual({
      model: 'test/model',
      providerMetadata: {
        model: 'test/model',
        provider: 'test-provider',
        status: 200,
      },
      finishReason: 'stop',
      promptTokens: 12,
      completionTokens: 7,
      reasoningTokens: 2,
    });
    expect(JSON.stringify(diagnostic)).not.toContain('never expose');
  });

  test('stops consuming provider chunks when generation is cancelled', async () => {
    const controller = new AbortController();
    let error: unknown;
    async function* chunks() {
      yield { choices: [{ delta: { content: '{"ok":' }, finishReason: null }] };
      yield { choices: [{ delta: { content: 'true}' }, finishReason: 'stop' }] };
    }

    try {
      await consumeStructuredChatStream(chunks(), schema, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ name: 'AbortError' });
  });

  test('maps streamed provider failures to the sanitized upstream code', async () => {
    let diagnostic: unknown;
    let error: unknown;
    async function* chunks() {
      yield {
        model: 'provider/model-version',
        openrouterMetadata: {
          attempts: [{
            model: 'provider/model-version',
            provider: 'failed-provider',
            status: 500,
          }],
        },
        error: { code: 500, message: 'secret provider detail' },
        choices: [],
      };
    }

    try {
      await consumeStructuredChatStream(chunks(), schema, {
        onDiagnostic: (value) => { diagnostic = value; },
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', message: 'UPSTREAM_ERROR' });
    expect(diagnostic).toMatchObject({
      model: 'provider/model-version',
      providerMetadata: {
        provider: 'failed-provider',
        status: 500,
      },
    });
  });

  test('sanitizes provider failures thrown by the async iterator', async () => {
    let error: unknown;
    async function* chunks() {
      yield {
        choices: [{ delta: { content: '{"ok":' }, finishReason: null }],
      };
      throw new Error('secret transport detail');
    }

    try {
      await generateStructuredObject({
        messages: [{ role: 'user', content: 'Return JSON.' }],
        schema,
        schemaName: 'health',
        maxTokens: 20_000,
        temperature: 0,
      }, {
        send: async () => chunks(),
        now: () => 100,
        log: () => {},
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'UPSTREAM_ERROR',
    });
    expect(JSON.stringify(error)).not.toContain('secret transport detail');
  });

  test('forwards cancellation and logs one sanitized diagnostic per provider attempt', async () => {
    const controller = new AbortController();
    const requests: unknown[] = [];
    const requestOptions: unknown[] = [];
    const records: unknown[] = [];
    const times = [1_000, 1_042];
    async function* chunks() {
      yield {
        model: 'provider/model-version',
        openrouterMetadata: {
          attempts: [{
            model: 'provider/model-version',
            provider: 'test-provider',
            status: 200,
          }],
        },
        usage: {
          promptTokens: 12,
          completionTokens: 7,
          totalTokens: 19,
          completionTokensDetails: { reasoningTokens: 2 },
        },
        choices: [{ delta: { content: '{"ok":true}' }, finishReason: 'stop' }],
      };
    }

    const result = await generateStructuredObject({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      schema,
      schemaName: 'health',
      maxTokens: 20_000,
      temperature: 0,
      route: 'insights',
      attempt: 1,
      signal: controller.signal,
    }, {
      send: async (request: unknown, options: unknown) => {
        requests.push(request);
        requestOptions.push(options);
        return chunks();
      },
      now: () => times.shift() as number,
      log: (record: unknown) => records.push(record),
    });

    expect(result).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ xOpenRouterMetadata: 'enabled' });
    expect(requestOptions[0]).toMatchObject({ retries: { strategy: 'none' } });
    expect((requestOptions[0] as { signal?: AbortSignal }).signal)
      .toBeInstanceOf(AbortSignal);
    expect(records).toEqual([{
      route: 'insights',
      model: 'provider/model-version',
      providerMetadata: {
        model: 'provider/model-version',
        provider: 'test-provider',
        status: 200,
      },
      attempt: 1,
      finishReason: 'stop',
      promptTokens: 12,
      completionTokens: 7,
      reasoningTokens: 2,
      durationMs: 42,
    }]);
    expect(JSON.stringify(records)).not.toContain('Return JSON');
  });

  test('sanitizes provider request failures without logging their details', async () => {
    const records: unknown[] = [];
    let error: unknown;
    try {
      await generateStructuredObject({
        messages: [{ role: 'user', content: 'secret prompt' }],
        schema,
        schemaName: 'health',
        maxTokens: 20_000,
        temperature: 0,
        route: 'report',
        attempt: 0,
      }, {
        send: async () => { throw new Error('secret provider detail'); },
        now: () => 100,
        log: (record: unknown) => records.push(record),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'UPSTREAM_ERROR', message: 'UPSTREAM_ERROR' });
    expect(records).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('secret');
  });

  test('streams the bounded structured-output budget through the approved provider order', () => {
    const request = buildStructuredChatRequest({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      schema,
      schemaName: 'health',
      maxTokens: 4_096,
      temperature: 0,
    });

    expect(request.chatRequest).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      stream: true,
      maxTokens: 4_096,
      provider: {
        requireParameters: true,
        order: ['CoreWeave', 'DeepInfra', 'StreamLake', 'Baidu'],
        allowFallbacks: false,
      },
      reasoning: {
        effort: 'none',
      },
      responseFormat: {
        type: 'json_schema',
        jsonSchema: {
          name: 'health',
          strict: true,
        },
      },
    });
    expect(request.chatRequest.provider).not.toHaveProperty('only');
    expect(request.chatRequest.provider).not.toHaveProperty('sort');
    expect('maxCompletionTokens' in request.chatRequest).toBe(false);
  });

  test('uses the shared token budget for insight and report generation requests', async () => {
    const requests: Array<{ chatRequest?: { maxTokens?: number } }> = [];
    const snapshot = {
      period: { from: null, to: null },
      rowCount: 1,
      kpis: { revenue: { current: 100, previous: null, delta: null } },
      leaders: { topCampaign: null, topChannel: null },
      rankings: { campaigns: [], channels: [], salespeople: [], products: [] },
      dimensions: { campaigns: [], channels: [], salespeople: [], products: [] },
      channelLeads: [],
      campaignConversion: [],
      funnel: [],
      daily: [],
      monthly: [],
    } satisfies AnalyticsSnapshot;
    const output = {
      summary: 'הביצועים מצביעים על מגמה חיובית.',
      insights: Array.from({ length: 3 }, () => ({
        title: 'תובנה מרכזית',
        explanation: 'ההכנסות מציגות ביצועים חזקים.',
        evidenceKeys: ['kpi.revenue.current'],
      })),
      trends: [{
        title: 'מגמה מרכזית',
        explanation: 'המגמה מצדיקה המשך מעקב.',
        evidenceKeys: ['kpi.revenue.current'],
      }],
      anomalies: [],
      exceptionalPerformers: [],
      recommendations: ['להמשיך לעקוב אחר הביצועים.', 'לבחון את איכות הלידים.'],
      investigate: ['לבדוק את מקורות השינוי.'],
    };

    for (const route of ['insights', 'report'] as const) {
      async function* chunks() {
        yield {
          choices: [{
            delta: { content: JSON.stringify(output) },
            finishReason: 'stop',
          }],
        };
      }
      await generateGroundedInsights(snapshot, {
        route,
        providerDependencies: {
          send: async (request: { chatRequest?: { maxTokens?: number } }) => {
            requests.push(request);
            return chunks();
          },
          now: () => 100,
          log: () => {},
        },
      });
    }

    expect(requests.map((request) => request.chatRequest?.maxTokens))
      .toEqual([4_096, 4_096]);
  });

  test('aborts an active provider stream at the total generation deadline', async () => {
    const deadlineController = new AbortController();
    let receivedTimeoutMs: number | undefined;
    let providerSignal: AbortSignal | undefined;
    let streamStartedResolve: (() => void) | undefined;
    const streamStarted = new Promise<void>((resolve) => {
      streamStartedResolve = resolve;
    });

    async function* chunks(signal: AbortSignal) {
      yield {
        choices: [{ delta: { content: '{"ok":' }, finishReason: null }],
      };
      streamStartedResolve?.();
      await new Promise<void>((_resolve, reject) => {
        const rejectForAbort = () => reject(signal.reason);
        if (signal.aborted) {
          rejectForAbort();
          return;
        }
        signal.addEventListener('abort', rejectForAbort, { once: true });
      });
    }

    const generation = generateStructuredObject({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      schema,
      schemaName: 'health',
      maxTokens: 4_096,
      temperature: 0,
    }, {
      createTimeoutSignal: (timeoutMs) => {
        receivedTimeoutMs = timeoutMs;
        return deadlineController.signal;
      },
      send: async (_request, requestOptions) => {
        providerSignal = requestOptions.signal;
        if (!providerSignal) {
          streamStartedResolve?.();
          throw new Error('deadline signal was not forwarded');
        }
        return chunks(providerSignal);
      },
      now: () => 100,
      log: () => {},
    });

    await streamStarted;
    deadlineController.abort(new DOMException('deadline', 'TimeoutError'));

    let error: unknown;
    try {
      await generation;
    } catch (caught) {
      error = caught;
    }

    expect(receivedTimeoutMs).toBe(120_000);
    expect(error).toMatchObject({
      code: 'UPSTREAM_ERROR',
      message: 'UPSTREAM_ERROR',
    });
    expect(providerSignal?.aborted).toBe(true);
  });

  test('parses and validates only textual JSON objects', () => {
    expect(parseStructuredChatContent('{"ok":true}', schema)).toEqual({ ok: true });
    expect(() => parseStructuredChatContent('{"ok":"yes"}', schema))
      .toThrow('AI_SCHEMA_INVALID_TYPE_OK');
    expect(() => parseStructuredChatContent('{"ok":', schema))
      .toThrow('AI_INVALID_JSON');
    expect(() => parseStructuredChatContent(null, schema)).toThrow('AI_EMPTY_RESPONSE');
    expect(() => parseStructuredChatContent([], schema)).toThrow('AI_EMPTY_RESPONSE');
  });

  test('classifies token-limit truncation before parsing partial JSON', () => {
    expect(() => parseStructuredChatChoice({
      finishReason: 'length',
      message: { content: '{"ok":' },
    }, schema)).toThrow('AI_TRUNCATED_RESPONSE');
  });

  test('rejects schema-valid content when the stream ends without a finish reason', async () => {
    async function* chunks() {
      yield {
        choices: [{ delta: { content: '{"ok":true}' }, finishReason: null }],
      };
    }

    let error: unknown;
    try {
      await consumeStructuredChatStream(chunks(), schema);
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({
      code: 'AI_INVALID_RESPONSE',
      message: 'AI_INVALID_RESPONSE',
    });
  });

  test('rejects abnormal finish reasons without retrying or exposing the reason', async () => {
    for (const finishReason of ['error', 'content_filter', 'tool_calls']) {
      let attempts = 0;
      let error: unknown;
      try {
        await withStructuredOutputRetry(async () => {
          attempts += 1;
          async function* chunks() {
            yield {
              choices: [{ delta: { content: '{"ok":true}' }, finishReason }],
            };
          }
          return consumeStructuredChatStream(chunks(), schema);
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toMatchObject({
        code: 'AI_INVALID_RESPONSE',
        message: 'AI_INVALID_RESPONSE',
      });
      expect(JSON.stringify(error)).not.toContain(finishReason);
      expect(attempts).toBe(1);
    }
  });

  test('normalizes an unknown finish reason before writing diagnostics', async () => {
    const records: unknown[] = [];
    async function* chunks() {
      yield {
        choices: [{
          delta: { content: '{"ok":true}' },
          finishReason: 'secret provider detail',
        }],
      };
    }

    let error: unknown;
    try {
      await generateStructuredObject({
        messages: [{ role: 'user', content: 'Return JSON.' }],
        schema,
        schemaName: 'health',
        maxTokens: 20_000,
        temperature: 0,
      }, {
        send: async () => chunks(),
        now: () => 100,
        log: (record: unknown) => records.push(record),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'AI_INVALID_RESPONSE' });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ finishReason: 'other' });
    expect(JSON.stringify(records)).not.toContain('secret provider detail');
  });

  test('never retries a streamed token-limit truncation', async () => {
    let attempts = 0;
    let error: unknown;
    try {
      await withStructuredOutputRetry(async () => {
        attempts += 1;
        async function* chunks() {
          yield {
            choices: [{ delta: { content: '{"ok":' }, finishReason: 'length' }],
          };
        }
        return consumeStructuredChatStream(chunks(), schema);
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'AI_TRUNCATED_RESPONSE' });
    expect(attempts).toBe(1);
  });

  test('retries one empty structured completion', async () => {
    let attempts = 0;
    const stages: string[] = [];
    const result = await withStructuredOutputRetry(async () => {
      attempts += 1;
      async function* chunks() {
        yield {
          choices: [{
            delta: { content: attempts === 1 ? '' : '{"ok":true}' },
            finishReason: 'stop',
          }],
        };
      }
      return consumeStructuredChatStream(chunks(), schema);
    }, { onProgress: (stage) => stages.push(stage) });

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(stages).toEqual(['retrying']);
  });

  test('validates each completed output before retrying malformed schema output', async () => {
    let attempts = 0;
    const stages: string[] = [];
    const onProgress = (stage: string) => stages.push(stage);
    const result = await withStructuredOutputRetry(async () => {
      attempts += 1;
      async function* chunks() {
        yield {
          choices: [{
            delta: { content: attempts === 1 ? '{"ok":"yes"}' : '{"ok":true}' },
            finishReason: 'stop',
          }],
        };
      }
      return consumeStructuredChatStream(chunks(), schema, { onProgress });
    }, { onProgress });

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
    expect(stages).toEqual([
      'generating',
      'validating',
      'retrying',
      'generating',
      'validating',
    ]);
  });

  test('retries one structurally invalid model response but not configuration failures', async () => {
    let attempts = 0;
    const result = await withStructuredOutputRetry(async (attempt) => {
      attempts += 1;
      if (attempt === 0) {
        throw Object.assign(new Error('schema'), {
          code: 'AI_SCHEMA_INVALID_VALUE_INSIGHTS_EVIDENCEKEYS',
        });
      }
      return { ok: true };
    });

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
    let configurationError: unknown;
    try {
      await withStructuredOutputRetry(async () => {
        throw Object.assign(new Error('missing key'), { code: 'AI_NOT_CONFIGURED' });
      });
    } catch (error) {
      configurationError = error;
    }
    expect(configurationError).toBeInstanceOf(Error);
    expect((configurationError as Error).message).toBe('missing key');
  });

  test('budgets slow structured responses without enabling SDK retries', () => {
    const signal = new AbortController().signal;
    const options = structuredOutputRequestOptions(signal);

    expect(options.timeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(options.timeoutMs * 2).toBeLessThanOrEqual(300_000);
    expect(options.retries).toEqual({ strategy: 'none' });
    expect(options.signal).toBe(signal);
  });

  test('encodes the no-numeric-claims rule in the provider JSON schema', () => {
    expect(JSON.stringify(z.toJSONSchema(insightsSchema)))
      .toContain('"pattern":"^[^\\\\d]*$"');
  });

  test('constrains generated evidence to the live catalog', () => {
    const schema = insightsSchemaForEvidenceKeys([
      'kpi.revenue.current',
      'leader.campaign',
    ]);
    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));

    expect(jsonSchema).toContain(
      '"enum":["kpi.revenue.current","leader.campaign"]',
    );
    expect(() => schema.parse({
      summary: 'הביצועים מצביעים על מגמה חיובית.',
      insights: Array.from({ length: 3 }, () => ({
        title: 'תובנה מרכזית',
        explanation: 'ההכנסות מציגות ביצועים חזקים.',
        evidenceKeys: ['fabricated.metric'],
      })),
      trends: [{
        title: 'מגמה מרכזית',
        explanation: 'המגמה מצביעה על ביצועים חזקים.',
        evidenceKeys: ['kpi.revenue.current'],
      }],
      anomalies: [],
      exceptionalPerformers: [],
      recommendations: ['להמשיך לעקוב אחר הביצועים.', 'לבחון את איכות הלידים.'],
      investigate: ['לבדוק את מקורות השינוי.'],
    })).toThrow();
  });

  test('rejects prose that reverses the sign of ROI evidence', () => {
    const output = insightsSchema.parse({
      summary: 'הביצועים מציגים תמונה מעורבת בתקופה.',
      insights: Array.from({ length: 3 }, () => ({
        title: 'ערוץ מפסיד כסף',
        explanation: 'הערוץ מציג תשואה שלילית ולכן אינו רווחי.',
        evidenceKeys: ['dimension.channels.0.roi'],
      })),
      trends: [{
        title: 'מגמה מרכזית',
        explanation: 'המגמה מצדיקה המשך מעקב.',
        evidenceKeys: ['dimension.channels.0.roi'],
      }],
      anomalies: [],
      exceptionalPerformers: [],
      recommendations: ['להמשיך לעקוב אחר הביצועים.', 'לבחון את איכות הלידים.'],
      investigate: ['לבדוק את מקורות השינוי.'],
    });
    const evidence = [{
      key: 'dimension.channels.0.roi',
      label: 'ROI · YouTube',
      value: 0.986,
      format: 'percent' as const,
    }];

    expect(() => validateInsightSemantics(output, evidence))
      .toThrow('AI_INVALID_EVIDENCE');
    expect(() => validateInsightSemantics(output, [{
      ...evidence[0],
      value: -0.014,
    }])).not.toThrow();
  });

  test('keeps KPI evidence and only notable dimension performers', () => {
    const metric = (
      name: string,
      revenue: number,
      roi: number,
      costPerLead: number,
    ): DimensionMetrics => ({
      name,
      revenue,
      spend: 10,
      leads: 1,
      deals: 1,
      conversionRate: 1,
      costPerLead,
      roi,
    });
    const channels = [
      metric('top', 100, 2, 10),
      metric('middle', 80, 1, 20),
      metric('ordinary', 60, 0.5, 30),
      metric('worst-roi', 40, -0.1, 40),
      metric('highest-cpl', 20, 0.2, 100),
    ];
    const snapshot = {
      period: { from: null, to: null },
      rowCount: 5,
      kpis: { revenue: { current: 300, previous: 250, delta: 0.2 } },
      leaders: { topCampaign: null, topChannel: null },
      rankings: { campaigns: [], channels: [], salespeople: [], products: [] },
      dimensions: { campaigns: [], channels, salespeople: [], products: [] },
      channelLeads: [],
      campaignConversion: [],
      funnel: [],
      daily: [],
      monthly: [],
    } satisfies AnalyticsSnapshot;
    const keys = insightEvidenceCatalog(snapshot).map((item) => item.key);

    expect(keys).toContain('kpi.revenue.current');
    expect(keys).toContain('dimension.channels.0.revenue');
    expect(keys).toContain('dimension.channels.3.roi');
    expect(keys).toContain('dimension.channels.4.costPerLead');
    expect(keys.some((key) => key.startsWith('dimension.channels.2.'))).toBe(false);
  });
});
