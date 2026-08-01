import { z } from 'zod';
import type { Evidence } from './grounding';

const groundedNarrative = z.string()
  .trim()
  .min(4)
  .max(800)
  .regex(/^[^\d]*$/, 'NUMERIC_CLAIMS_REQUIRE_EVIDENCE');

const unconstrainedEvidenceKey = z.string().trim().min(1).max(100);

const createInsightsSchema = (evidenceKey: z.ZodType<string>) => {
  const insightItemSchema = z.object({
    title: groundedNarrative.max(120),
    explanation: groundedNarrative,
    evidenceKeys: z.array(evidenceKey).min(1).max(8),
  });

  return z.object({
    summary: groundedNarrative,
    insights: z.array(insightItemSchema).length(3),
    trends: z.array(insightItemSchema).min(1).max(2),
    anomalies: z.array(insightItemSchema).max(2),
    exceptionalPerformers: z.array(insightItemSchema).max(2),
    recommendations: z.array(groundedNarrative).min(2).max(4),
    investigate: z.array(groundedNarrative).min(1).max(3),
  });
};

export const insightsSchema = createInsightsSchema(unconstrainedEvidenceKey);

export function insightsSchemaForEvidenceKeys(evidenceKeys: string[]) {
  if (evidenceKeys.length === 0) {
    throw Object.assign(new Error('AI_INVALID_EVIDENCE'), {
      code: 'AI_INVALID_EVIDENCE',
    });
  }
  return createInsightsSchema(z.enum(evidenceKeys as [string, ...string[]]));
}

export type InsightsOutput = z.infer<typeof insightsSchema>;

export function validateInsightEvidence(
  output: InsightsOutput,
  allowedEvidenceKeys: Set<string>,
) {
  const items = [
    ...output.insights,
    ...output.trends,
    ...output.anomalies,
    ...output.exceptionalPerformers,
  ];
  if (items.some((item) => (
    item.evidenceKeys.length === 0
    || item.evidenceKeys.some((key) => !allowedEvidenceKeys.has(key))
  ))) {
    throw Object.assign(new Error('AI_INVALID_EVIDENCE'), {
      code: 'AI_INVALID_EVIDENCE',
    });
  }
}

const negativeRoiLanguage = /(?:תשואה שלילית|החזר שלילי|מפסיד(?:ה)? כסף|אינו רווחי|אינה רווחית|הפסד)/;
const positiveRoiLanguage = /(?:תשואה חיובית|רווחיות חיובית|רווחי במיוחד|רווחית במיוחד)/;
const isRoiEvidence = (key: string) => key === 'kpi.roi.current' || key.endsWith('.roi');

export function validateInsightSemantics(
  output: InsightsOutput,
  evidence: Evidence[],
) {
  const evidenceByKey = new Map(evidence.map((item) => [item.key, item]));
  const items = [
    ...output.insights,
    ...output.trends,
    ...output.anomalies,
    ...output.exceptionalPerformers,
  ];

  for (const item of items) {
    const narrative = `${item.title} ${item.explanation}`;
    const roiValues = item.evidenceKeys
      .filter(isRoiEvidence)
      .map((key) => evidenceByKey.get(key)?.value)
      .filter((value): value is number => typeof value === 'number');
    const reversesPositive = negativeRoiLanguage.test(narrative)
      && roiValues.length > 0
      && roiValues.every((value) => value >= 0);
    const reversesNegative = positiveRoiLanguage.test(narrative)
      && roiValues.length > 0
      && roiValues.every((value) => value <= 0);

    if (reversesPositive || reversesNegative) {
      throw Object.assign(new Error('AI_INVALID_EVIDENCE'), {
        code: 'AI_INVALID_EVIDENCE',
      });
    }
  }
}
