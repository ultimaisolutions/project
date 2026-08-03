import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  buildStructuredChatRequest,
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

describe('OpenRouter structured output adapter', () => {
  const schema = z.object({ ok: z.boolean() });

  test('uses the provider-compatible token field and strict routing', () => {
    const request = buildStructuredChatRequest({
      messages: [{ role: 'user', content: 'Return JSON.' }],
      schema,
      schemaName: 'health',
      maxTokens: 100,
      temperature: 0,
    });

    expect(request.chatRequest).toMatchObject({
      model: 'deepseek/deepseek-v4-flash',
      stream: false,
      maxTokens: 100,
      provider: {
        requireParameters: true,
        sort: 'throughput',
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
    expect('maxCompletionTokens' in request.chatRequest).toBe(false);
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
    const options = structuredOutputRequestOptions();

    expect(options.timeoutMs).toBeGreaterThanOrEqual(120_000);
    expect(options.timeoutMs * 2).toBeLessThanOrEqual(300_000);
    expect(options.retries).toEqual({ strategy: 'none' });
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
