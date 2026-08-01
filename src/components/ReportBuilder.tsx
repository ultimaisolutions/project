import { useEffect, useState } from 'react';
import type { Evidence } from '../lib/ai/grounding';
import {
  reportToCsv,
  type ManagementReport,
} from '../lib/report';
import Chart from './dashboard/Chart';
import './report-builder.css';

type ReportResponse = {
  report: ManagementReport;
  evidence: Evidence[];
  generatedAt: string;
  lastSyncAt: string | null;
};

const errors: Record<string, string> = {
  NOT_CONNECTED: 'יש לחבר מקור נתונים לפני יצירת הדוח.',
  NO_DATA: 'לא נמצאו נתונים עבור התקופה והמסננים שנבחרו.',
  AI_NOT_CONFIGURED: 'שירות ה-AI עדיין אינו מוגדר בצד השרת.',
  AI_INVALID_EVIDENCE: 'הדוח לא עבר את בדיקת ביסוס הנתונים. נסו ליצור אותו שוב.',
  TIMEOUT: 'יצירת הדוח נמשכה זמן רב מדי. נסו שוב.',
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

const kpiTypes: Record<string, 'currency' | 'number' | 'percent'> = {
  revenue: 'currency',
  actualSpend: 'currency',
  leads: 'number',
  deals: 'number',
  conversionRate: 'percent',
  costPerLead: 'currency',
  costPerDeal: 'currency',
  roi: 'percent',
};

const chartMeta = [
  ['trend', 'הכנסות מול הוצאות', 'line', 'currency'],
  ['channelLeads', 'לידים לפי ערוץ', 'bar', 'number'],
  ['campaignConversion', 'המרה לפי קמפיין', 'bar', 'percent'],
  ['funnel', 'משפך מכירות', 'funnel', 'number'],
] as const;

function format(value: number | null, type: string) {
  if (value == null) return '—';
  if (type === 'currency') return currency.format(value);
  if (type === 'percent') return percent.format(value);
  return number.format(value);
}

export default function ReportBuilder() {
  const [result, setResult] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(`sts-report:${window.location.search}`);
      if (saved) setResult(JSON.parse(saved) as ReportResponse);
    } catch {
      sessionStorage.removeItem(`sts-report:${window.location.search}`);
    }
  }, []);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: window.location.search }),
      });
      const body = await response.json() as ReportResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? 'REPORT_ERROR');
      setResult(body);
      sessionStorage.setItem(
        `sts-report:${window.location.search}`,
        JSON.stringify(body),
      );
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const downloadCsv = () => {
    if (!result) return;
    const blob = new Blob([reportToCsv(result.report)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `sts-iconic-report-${result.report.period.from ?? 'all'}-${result.report.period.to ?? 'all'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!result) {
    return (
      <section className="card report-welcome">
        <div className="report-icon" aria-hidden="true">▤</div>
        <p className="eyebrow">דוח ניהולי אוטומטי</p>
        <h2>כל תמונת המצב, במסמך אחד</h2>
        <p>
          הדוח ישלב את התקופה והמסננים הפעילים עם המדדים, הגרפים, התובנות,
          החריגות וההמלצות שנוצרו באמצעות AI.
        </p>
        {error && <div className="report-error" role="alert">{errors[error] ?? 'יצירת הדוח נכשלה. נסו שוב.'}</div>}
        <button className="btn primary" disabled={loading} onClick={() => void generate()}>
          {loading ? 'יוצר דוח ומנתח נתונים…' : 'יצירת דוח ניהולי'}
        </button>
        <small>מדדים מסוכמים נשלחים ל-OpenRouter. הדוח נשמר בלשונית הדפדפן וניתן לייצא ל-CSV או ל-PDF.</small>
      </section>
    );
  }

  const report = result.report;
  return (
    <div className="report-page">
      <section className="report-actions card" data-print-hidden>
        <div>
          <strong>הדוח מוכן</strong>
          <span className="ltr">{new Date(result.generatedAt).toLocaleString('he-IL')}</span>
        </div>
        <div>
          <button className="btn" disabled={loading} onClick={() => void generate()}>
            {loading ? 'מעדכן…' : 'יצירה מחדש'}
          </button>
          <button className="btn" onClick={downloadCsv}>הורדת CSV</button>
          <button className="btn primary" onClick={() => window.print()}>ייצוא PDF</button>
        </div>
      </section>
      {error && <div className="report-error" role="alert">{errors[error] ?? 'עדכון הדוח נכשל.'}</div>}

      <article className="management-report card">
        <header className="report-cover">
          <div className="report-logo">S</div>
          <div>
            <p>STSICONIC · BUSINESS INTELLIGENCE</p>
            <h2>דוח ביצועים ניהולי</h2>
            <span>
              תקופה: <b className="ltr">{report.period.from ?? '—'} – {report.period.to ?? '—'}</b>
            </span>
          </div>
          <aside>
            <span>מקור נתונים</span>
            <strong>{report.sourceName}</strong>
            <small>{report.rowCount} שורות</small>
            <small>נוצר: <span className="ltr">{new Date(result.generatedAt).toLocaleString('he-IL')}</span></small>
            <small>
              סנכרון: <span className="ltr">{result.lastSyncAt ? new Date(result.lastSyncAt).toLocaleString('he-IL') : 'לא זמין'}</span>
            </small>
          </aside>
        </header>

        <section className="report-summary">
          <p className="eyebrow">סיכום ביצועים</p>
          <h3>{report.insights.summary}</h3>
        </section>

        <section>
          <h3 className="report-section-title">מדדים מרכזיים</h3>
          <div className="report-kpis">
            {Object.entries(report.kpis).map(([key, metric]) => (
              <div key={key}>
                <span>{metric.label}</span>
                <strong className="ltr">{format(metric.current, kpiTypes[key] ?? 'number')}</strong>
                <small className="ltr">
                  {metric.delta == null ? 'ללא השוואה' : `${metric.delta >= 0 ? '+' : ''}${percent.format(metric.delta)}`}
                </small>
              </div>
            ))}
            {([
              ['הקמפיין המוביל', report.leaders.topCampaign],
              ['ערוץ הפרסום המוביל', report.leaders.topChannel],
            ] as const).map(([label, leader]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{leader?.name ?? '—'}</strong>
                <small className="ltr">
                  {leader ? `${currency.format(leader.revenue)} הכנסות` : 'אין נתון'}
                </small>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h3 className="report-section-title">גרפים מרכזיים</h3>
          <div className="report-charts">
            {chartMeta.map(([key, title, kind, valueType]) => (
              <div key={key}>
                <h4>{title}</h4>
                <Chart
                  kind={kind}
                  data={report.charts[key]}
                  label={title}
                  valueType={valueType}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="report-insights">
          <div>
            <h3 className="report-section-title">תובנות AI</h3>
            {report.insights.insights.map((item) => (
              <article key={item.title}>
                <h4>{item.title}</h4>
                <p>{item.explanation}</p>
              </article>
            ))}
          </div>
          <div>
            <h3 className="report-section-title">חריגות שזוהו</h3>
            {report.insights.anomalies.length === 0
              ? <p className="report-empty">לא זוהתה חריגה מבוססת בתקופה.</p>
              : report.insights.anomalies.map((item) => (
                <article key={item.title}>
                  <h4>{item.title}</h4>
                  <p>{item.explanation}</p>
                </article>
              ))}
          </div>
        </section>

        <section className="report-recommendations">
          <h3 className="report-section-title">המלצות להמשך</h3>
          <ol>{report.insights.recommendations.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>
      </article>
    </div>
  );
}
