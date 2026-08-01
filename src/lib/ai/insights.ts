import type { ChatMessages } from '@openrouter/sdk/models';
import {
  evidenceForKeys,
  insightEvidenceCatalog,
  type AnalyticsSnapshot,
} from './grounding';
import {
  insightsSchemaForEvidenceKeys,
  validateInsightEvidence,
  validateInsightSemantics,
} from './insights-schema';
import {
  generateStructuredObject,
  withStructuredOutputRetry,
} from './openrouter';

const instructions = `
אתה אנליסט עסקי בכיר. כתוב בעברית בהירה, קצרה ומעשית.
כל המידע העסקי מגיע מאובייקט JSON שהשרת חישב מנתוני Google Sheets שנבחרו.
אסור להמציא נתון, שם, סיבה או קשר שאינם מופיעים באובייקט.
אסור לכתוב ספרות או ערכים מספריים בטקסט החופשי. המספרים יוצגו בנפרד על ידי המערכת.
לכל תובנה, מגמה, חריגה או ביצוע חריג חובה לבחור evidenceKeys מהרשימה המותרת בלבד.
ROI מחושב כהכנסה פחות הוצאה, חלקי ההוצאה. ROI שלילי רק כאשר הערך קטן מאפס; כל ערך גדול מאפס הוא רווח חיובי, גם כאשר הוא קטן מאחת.
אסור לתאר ROI חיובי כהפסד, כתשואה שלילית או כערוץ שאינו רווחי. בסימני שינוי, ערך קטן מאפס הוא ירידה וערך גדול מאפס הוא עלייה.
אם אין די ראיות לחריגה או לביצוע חריג, החזר מערך ריק בתחום המתאים.
כתוב סיכום של עד שני משפטים קצרים ומשפט הסבר קצר אחד בכל פריט.
`.trim();

const evidenceInterpretation = (item: ReturnType<typeof insightEvidenceCatalog>[number]) => {
  if ((item.key === 'kpi.roi.current' || item.key.endsWith('.roi'))
    && typeof item.value === 'number') {
    return item.value < 0 ? 'ROI שלילי והפסדי' : 'ROI חיובי ורווחי';
  }
  if (item.key.endsWith('.delta') && typeof item.value === 'number') {
    return item.value < 0 ? 'ירידה לעומת התקופה הקודמת' : 'עלייה לעומת התקופה הקודמת';
  }
  return undefined;
};

const retryInstructions = `
התשובה הקודמת לא התאימה לסכמת הפלט המחמירה.
החזר אובייקט JSON בלבד שתואם לסכמה בדיוק.
כל evidenceKeys חייב להיות העתק מדויק של מפתח מרשימת הראיות המותרות שכבר ניתנה.
אין לכתוב ספרות בטקסט החופשי ואין להוסיף שדות שאינם בסכמה.
`.trim();

export async function generateGroundedInsights(snapshot: AnalyticsSnapshot) {
  if (snapshot.rowCount === 0) {
    throw Object.assign(new Error('NO_DATA'), { code: 'NO_DATA' });
  }

  const catalog = insightEvidenceCatalog(snapshot);
  const allowedKeys = new Set(catalog.map((item) => item.key));
  const outputSchema = insightsSchemaForEvidenceKeys([...allowedKeys]);
  const messages: ChatMessages[] = [
    { role: 'system', content: instructions },
    {
      role: 'user',
      content: [
        'נתח את תמונת המצב העסקית הבאה.',
        'החזר בדיוק שלוש תובנות מרכזיות.',
        'החזר עד שתי מגמות, עד שתי חריגות, עד שני ביצועים חריגים, שלוש המלצות ושתי נקודות לבדיקה.',
        `ראיות מותרות, כולל משמעות וסימן: ${JSON.stringify(catalog.map((item) => ({
          ...item,
          interpretation: evidenceInterpretation(item),
        })))}`,
      ].join('\n\n'),
    },
  ];
  const output = await withStructuredOutputRetry((attempt) => generateStructuredObject({
    messages: attempt === 0
      ? messages
      : [...messages, { role: 'system', content: retryInstructions }],
    schema: outputSchema,
    schemaName: 'stsiconic_insights',
    maxTokens: 3_200,
    temperature: attempt === 0 ? 0.2 : 0,
  }));

  validateInsightEvidence(output, allowedKeys);
  validateInsightSemantics(output, catalog);
  const referencedKeys = [
    ...output.insights,
    ...output.trends,
    ...output.anomalies,
    ...output.exceptionalPerformers,
  ].flatMap((item) => item.evidenceKeys);

  return {
    ...output,
    evidence: evidenceForKeys(snapshot, referencedKeys),
  };
}
