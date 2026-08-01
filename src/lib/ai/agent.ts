import { ToolLoopAgent, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import {
  evidenceForAgent,
  formatMetricForAgent,
  rankDimensionForAgent,
  type DimensionMetric,
  type DimensionName,
} from './agent-tools';
import type { AnalyticsSnapshot } from './grounding';
import { languageModel } from './model';
import {
  generateMarketingImage,
  imageTypeSchema,
  storeImageAsset,
} from './image';

const dimensionLabels: Record<DimensionName, string> = {
  campaigns: 'קמפיינים',
  channels: 'ערוצי פרסום',
  salespeople: 'אנשי מכירות',
  products: 'מוצרים או שירותים',
};

const metricLabels: Record<DimensionMetric, string> = {
  revenue: 'הכנסות',
  spend: 'הוצאות',
  leads: 'לידים',
  deals: 'עסקאות',
  conversionRate: 'שיעור המרה',
  costPerLead: 'עלות לליד',
  roi: 'החזר על ההשקעה',
};

export function createAnalyticsAgent(snapshot: AnalyticsSnapshot, userId: string) {
  return new ToolLoopAgent({
    model: languageModel(),
    instructions: `
אתה סוכן BI עסקי דובר עברית. ענה רק על בסיס תוצאות הכלים המצורפים.
בכל תשובה עסקית חובה לקרוא לכלי אחד לפחות לפני המענה.
אין להסיק סיבה שלא קיימת בנתונים ואין להמציא שם, ערך או תקופה.
כל הערכים שמוחזרים מהכלים כבר מעוצבים ביחידות התצוגה הסופיות. יש להעתיק אחוזים ומטבע בדיוק כפי שהכלי החזיר אותם, בלי להמיר יחס עשרוני ובלי להשמיט את סימן האחוזים.
ציין בקצרה את המסקנה, הסבר את המשמעות העסקית, והפנה את המשתמש לאזור "הנתונים שעליהם התשובה מבוססת".
כאשר אין נתונים מספיקים אמור זאת במפורש.
שמור על המשכיות בין שאלות המשך, אך בצע כלי מחדש לכל שאלה כדי לבסס את התשובה.
`.trim(),
    tools: {
      overview: tool({
        description: 'Get the exact KPI overview, leaders, period, and evidence catalog for the selected data.',
        inputSchema: z.object({}),
        execute: async () => ({
          period: snapshot.period,
          rowCount: snapshot.rowCount,
          leaders: snapshot.leaders,
          evidence: evidenceForAgent(snapshot),
        }),
      }),
      rankPerformance: tool({
        description: 'Rank campaigns, channels, salespeople, or products by a deterministic business metric.',
        inputSchema: z.object({
          dimension: z.enum(['campaigns', 'channels', 'salespeople', 'products']),
          metric: z.enum([
            'revenue',
            'spend',
            'leads',
            'deals',
            'conversionRate',
            'costPerLead',
            'roi',
          ]),
          direction: z.enum(['best', 'worst']),
          limit: z.number().int().min(1).max(10).default(5),
        }),
        execute: async (input) => ({
          ...rankDimensionForAgent(snapshot, input),
          dimensionLabel: dimensionLabels[input.dimension],
          metricLabel: metricLabels[input.metric],
        }),
      }),
      compareMonths: tool({
        description: 'Compare exact monthly performance values and identify changes over time.',
        inputSchema: z.object({
          metric: z.enum([
            'revenue',
            'spend',
            'leads',
            'deals',
            'conversionRate',
            'roi',
          ]),
        }),
        execute: async ({ metric }) => ({
          metric,
          months: snapshot.monthly.map((month) => ({
            month: month.month,
            value: formatMetricForAgent(metric, month[metric]),
          })),
        }),
      }),
      inspectTrend: tool({
        description: 'Inspect the exact daily revenue and spend trend in the selected period.',
        inputSchema: z.object({}),
        execute: async () => ({
          period: snapshot.period,
          daily: snapshot.daily,
        }),
      }),
      createMarketingImage: tool({
        description: 'Generate a real marketing image from the selected analytics. Use only when the user explicitly asks to create or generate an image.',
        inputSchema: z.object({
          type: imageTypeSchema,
        }),
        execute: async ({ type }) => {
          const image = await generateMarketingImage(snapshot, type, userId);
          const assetId = storeImageAsset(userId, image);
          return {
            assetId,
            title: image.title,
            prompt: image.prompt,
            mimeType: image.mimeType,
          };
        },
      }),
    },
    stopWhen: stepCountIs(6),
    prepareStep: ({ stepNumber }) => stepNumber === 0
      ? { toolChoice: 'required' }
      : {},
  });
}
