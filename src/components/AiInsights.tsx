import { useEffect, useRef, useState } from 'react';
import {
  fetchAiGeneration,
  type AiProgressStage,
} from '../lib/ai-stream-client';
import AiGenerationProgress from './AiGenerationProgress';
import './ai-insights.css';

type Evidence = {
  key: string;
  label: string;
  value: string | number | null;
  detail?: number;
  format: 'currency' | 'number' | 'percent' | 'text' | 'text-currency';
};
type InsightItem = {
  title: string;
  explanation: string;
  evidenceKeys: string[];
};
type InsightsResponse = {
  insights: {
    summary: string;
    insights: InsightItem[];
    trends: InsightItem[];
    anomalies: InsightItem[];
    exceptionalPerformers: InsightItem[];
    recommendations: string[];
    investigate: string[];
    evidence: Evidence[];
  };
  context: {
    period: { from: string | null; to: string | null };
    rowCount: number;
    lastSyncAt: string | null;
    worksheetName: string;
  };
};

const errors: Record<string, string> = {
  NOT_CONNECTED: 'יש לחבר מקור נתונים תקין לפני הפעלת הניתוח.',
  NO_DATA: 'לא נמצאו נתונים בתקופה או במסננים שנבחרו.',
  AI_NOT_CONFIGURED: 'שירות הניתוח עדיין אינו מוגדר בצד השרת.',
  AI_INVALID_EVIDENCE: 'המודל החזיר תוצאה שלא עמדה בכללי ביסוס הנתונים. נסו שוב.',
  TIMEOUT: 'הניתוח נמשך זמן רב מדי. נסו שוב בעוד רגע.',
};

const currency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});
const number = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** Formats one grounded evidence value according to its declared display type. */
function formatEvidence(item: Evidence) {
  if (item.value == null) return 'אין נתון';
  if (item.format === 'currency') return currency.format(item.value as number);
  if (item.format === 'percent') return percent.format(item.value as number);
  if (item.format === 'number') return number.format(item.value as number);
  if (item.format === 'text-currency') {
    return `${item.value} · ${currency.format(item.detail ?? 0)}`;
  }
  return String(item.value);
}

/** Renders a titled insight collection with the evidence supporting each item. */
function InsightCards({
  title,
  items,
  evidence,
  empty,
}: {
  title: string;
  items: InsightItem[];
  evidence: Map<string, Evidence>;
  empty: string;
}) {
  return (
    <section className="insight-section">
      <header>
        <h2>{title}</h2>
        <span>{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="section-empty">{empty}</p>
      ) : (
        <div className="insight-list">
          {items.map((item, index) => (
            <article className="card insight-card" key={`${item.title}-${index}`}>
              <span className="insight-index">{index + 1}</span>
              <div>
                <h3>{item.title}</h3>
                <p>{item.explanation}</p>
                <dl>
                  {item.evidenceKeys.map((key) => {
                    const source = evidence.get(key);
                    if (!source) return null;
                    return (
                      <div key={key}>
                        <dt>{source.label}</dt>
                        <dd className="ltr">{formatEvidence(source)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

/** Mirrors the final summary and insight-card geometry during first generation. */
function InsightsSkeleton({ stage }: { stage: AiProgressStage }) {
  return (
    <div
      className="insights-page insights-loading"
      data-testid="insights-skeleton"
      aria-busy="true"
    >
      <AiGenerationProgress stage={stage} />
      <section className="card executive-summary insights-skeleton-summary" aria-hidden="true">
        <div>
          <div className="ai-skeleton-block skeleton-eyebrow" />
          <div className="ai-skeleton-block skeleton-summary-line" />
          <div className="ai-skeleton-block skeleton-summary-line short" />
          <div className="ai-skeleton-block skeleton-meta-line" />
        </div>
      </section>
      <section className="insight-section insights-skeleton-cards" aria-hidden="true">
        <header>
          <div className="ai-skeleton-block skeleton-section-title" />
        </header>
        <div className="insight-list">
          {[0, 1, 2].map((index) => (
            <article className="card insight-card" key={index}>
              <div className="ai-skeleton-block skeleton-index" />
              <div>
                <div className="ai-skeleton-block skeleton-card-title" />
                <div className="ai-skeleton-block skeleton-card-line" />
                <div className="ai-skeleton-block skeleton-card-line short" />
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Provides the interactive, filter-aware AI insights experience. */
export default function AiInsights() {
  const [result, setResult] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<AiProgressStage>('loading-data');
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => {
    requestIdRef.current += 1;
    requestRef.current?.abort();
  }, []);

  /** Requests a fresh grounded analysis for the filters in the current URL. */
  const analyze = async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    setStage('loading-data');
    try {
      const body = await fetchAiGeneration<InsightsResponse>('/api/ai/insights', {
        query: window.location.search,
      }, {
        signal: controller.signal,
        onProgress: (nextStage) => {
          if (requestIdRef.current === requestId) setStage(nextStage);
        },
      });
      if (requestIdRef.current === requestId) setResult(body);
    } catch (caught) {
      if (requestIdRef.current === requestId && !controller.signal.aborted) {
        setError((caught as Error).message);
      }
    } finally {
      if (requestIdRef.current === requestId) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  if (!result && loading) return <InsightsSkeleton stage={stage} />;

  if (!result) {
    return (
      <section className="card insight-welcome">
        <div className="ai-orb" aria-hidden="true">✦</div>
        <p className="eyebrow">ניתוח מבוסס נתונים</p>
        <h2>מה מסתתר מאחורי הביצועים?</h2>
        <p>
          המערכת תנתח את נתוני Google Sheets לפי המסננים שבחרתם ותציג תובנות,
          מגמות, חריגות והמלצות עם המדדים שעליהם הן מבוססות.
        </p>
        {error && <div className="ai-error" role="alert">{errors[error] ?? 'הניתוח נכשל. נסו שוב.'}</div>}
        <button className="btn primary analyze-button" onClick={() => void analyze()}>
          ✦ נתח את הנתונים
        </button>
        <small>מדדים מסוכמים נשלחים ל-OpenRouter לצורך הניתוח; אין גישה ישירה לגיליון ונתוני המקור אינם משתנים.</small>
      </section>
    );
  }

  const evidence = new Map(result.insights.evidence.map((item) => [item.key, item]));
  return (
    <div
      className="insights-page"
      data-testid="insights-page"
      aria-busy={loading}
    >
      <section className="card executive-summary">
        <div>
          <p className="eyebrow">סיכום ניהולי</p>
          <h2>{result.insights.summary}</h2>
          <p className="analysis-meta">
            {result.context.rowCount} שורות · לשונית {result.context.worksheetName}
            {result.context.lastSyncAt && (
              <> · סנכרון <span className="ltr">{new Date(result.context.lastSyncAt).toLocaleString('he-IL')}</span></>
            )}
          </p>
        </div>
        <button className="btn" onClick={() => void analyze()}>
          {loading ? 'מנתח…' : 'ניתוח מחדש'}
        </button>
      </section>
      {loading && <AiGenerationProgress stage={stage} />}
      {error && <div className="ai-error" role="alert">{errors[error] ?? 'הניתוח מחדש נכשל.'}</div>}

      <InsightCards
        title="שלוש התובנות המרכזיות"
        items={result.insights.insights}
        evidence={evidence}
        empty="לא נמצאו תובנות מספקות."
      />
      <div className="insight-columns">
        <InsightCards
          title="מגמות"
          items={result.insights.trends}
          evidence={evidence}
          empty="לא זוהתה מגמה מובהקת בתקופה."
        />
        <InsightCards
          title="חריגות"
          items={result.insights.anomalies}
          evidence={evidence}
          empty="לא זוהתה חריגה מבוססת נתונים."
        />
      </div>
      <InsightCards
        title="קמפיינים ואנשי מכירות חריגים"
        items={result.insights.exceptionalPerformers}
        evidence={evidence}
        empty="לא זוהו ביצועים חריגים בקבוצות אלו."
      />

      <div className="action-grid">
        <section className="card recommendation-card">
          <p className="eyebrow">המלצות להמשך</p>
          <h2>פעולות מעשיות</h2>
          <ol>{result.insights.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>
        <section className="card recommendation-card secondary">
          <p className="eyebrow">בדיקה נוספת</p>
          <h2>נקודות שכדאי לבדוק לעומק</h2>
          <ul>{result.insights.investigate.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
