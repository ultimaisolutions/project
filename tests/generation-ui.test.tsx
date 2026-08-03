import './setup-dom';
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import type { ManagementReport } from '../src/lib/report';

mock.module('../src/components/dashboard/Chart', () => ({
  default: ({ label }: { label: string }) => (
    <div className="chart-canvas" role="img" aria-label={label} />
  ),
}));

const { default: AiInsights } = await import('../src/components/AiInsights');
const { default: ReportBuilder } = await import('../src/components/ReportBuilder');

const originalFetch = globalThis.fetch;
const encoder = new TextEncoder();

const insights = {
  summary: 'ההכנסות מצביעות על ביצועים יציבים.',
  insights: [
    {
      title: 'הכנסות יציבות',
      explanation: 'ההכנסות נשמרו לאורך התקופה.',
      evidenceKeys: ['kpi.revenue.current'],
    },
    {
      title: 'איכות לידים',
      explanation: 'יחס ההמרה נשאר חיובי.',
      evidenceKeys: ['kpi.conversionRate.current'],
    },
    {
      title: 'שליטה בהוצאות',
      explanation: 'ההוצאה נשארה בגבולות היעד.',
      evidenceKeys: ['kpi.actualSpend.current'],
    },
  ],
  trends: [],
  anomalies: [],
  exceptionalPerformers: [],
  recommendations: ['להמשיך לעקוב.', 'לבחון את איכות הלידים.', 'לשמר את התקציב.'],
  investigate: ['לבדוק את ערוץ Google.'],
  evidence: [
    {
      key: 'kpi.revenue.current',
      label: 'סך הכנסות בתקופה',
      value: 8_000,
      format: 'currency' as const,
    },
    {
      key: 'kpi.conversionRate.current',
      label: 'שיעור המרה',
      value: 0.2,
      format: 'percent' as const,
    },
    {
      key: 'kpi.actualSpend.current',
      label: 'סך הוצאות בתקופה',
      value: 1_000,
      format: 'currency' as const,
    },
  ],
};

const insightsResult = {
  insights,
  context: {
    period: { from: '2026-07-01', to: '2026-07-31' },
    rowCount: 12,
    lastSyncAt: '2026-08-03T08:30:00.000Z',
    worksheetName: 'נתונים',
  },
};

const report: ManagementReport = {
  sourceName: 'נתונים',
  period: { from: '2026-07-01', to: '2026-07-31' },
  rowCount: 12,
  kpis: {
    revenue: { label: 'סך הכנסות', current: 8_000, previous: 7_000, delta: 1 / 7 },
    actualSpend: { label: 'סך הוצאות', current: 1_000, previous: 900, delta: 1 / 9 },
  },
  leaders: {
    topCampaign: { name: 'קיץ', revenue: 8_000 },
    topChannel: { name: 'Google', revenue: 8_000 },
  },
  insights,
  charts: {
    trend: [],
    channelLeads: [],
    campaignConversion: [],
    salespeople: [],
    products: [],
    funnel: [],
  },
};

const reportResult = {
  report,
  evidence: insights.evidence,
  generatedAt: '2026-08-03T09:45:00.000Z',
  lastSyncAt: '2026-08-03T08:30:00.000Z',
};

class PendingStream {
  readonly response: Response;
  cancelled = false;
  private controller!: ReadableStreamDefaultController<Uint8Array>;

  constructor() {
    this.response = new Response(new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.cancelled = true;
      },
    }), {
      headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
    });
  }

  event(event: unknown) {
    this.controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
  }

  close() {
    this.controller.close();
  }
}

function mockStreamingFetch() {
  const streams: PendingStream[] = [];
  const requests: RequestInit[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new PendingStream();
      streams.push(stream);
      requests.push(init ?? {});
      return stream.response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return { streams, requests };
}

async function waitForRequest(streams: PendingStream[], index = 0) {
  await waitFor(() => expect(streams.length).toBeGreaterThan(index));
  return streams[index];
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});

describe('AI insights streaming UI', () => {
  test('replaces the welcome card with an accessible skeleton and follows streamed stages to the result', async () => {
    const { streams, requests } = mockStreamingFetch();
    const view = render(<AiInsights />);

    fireEvent.click(view.getByRole('button', { name: '✦ נתח את הנתונים' }));

    const skeleton = view.getByTestId('insights-skeleton');
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(view.queryByText('מה מסתתר מאחורי הביצועים?')).toBeNull();
    expect(view.getByRole('status').textContent).toContain('טוען ומסכם את הנתונים…');
    const stream = await waitForRequest(streams);
    expect(new Headers(requests[0]?.headers).get('accept')).toBe('application/x-ndjson');

    stream.event({ type: 'progress', stage: 'generating' });
    await view.findByText('DeepSeek מנתח את הביצועים…');
    stream.event({ type: 'progress', stage: 'validating' });
    await view.findByText('מאמת את התובנות מול הנתונים…');
    stream.event({ type: 'result', data: insightsResult });
    stream.close();

    expect(await view.findByText(insights.summary)).not.toBeNull();
    expect(view.queryByTestId('insights-skeleton')).toBeNull();
  });

  test('keeps a result during regeneration, aborts a repeated request, and restores controls after failure', async () => {
    const { streams, requests } = mockStreamingFetch();
    const view = render(<AiInsights />);
    fireEvent.click(view.getByRole('button', { name: '✦ נתח את הנתונים' }));
    const first = await waitForRequest(streams);
    first.event({ type: 'result', data: insightsResult });
    first.close();
    expect(await view.findByText(insights.summary)).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'ניתוח מחדש' }));
    const second = await waitForRequest(streams, 1);
    second.event({ type: 'progress', stage: 'retrying' });
    expect(await view.findByText('מחדד את התוצאה…')).not.toBeNull();
    expect(view.getByText(insights.summary)).not.toBeNull();
    expect(view.getByTestId('insights-page').getAttribute('aria-busy')).toBe('true');

    fireEvent.click(view.getByRole('button', { name: 'מנתח…' }));
    const third = await waitForRequest(streams, 2);
    expect(requests[1]?.signal?.aborted).toBe(true);
    expect(second.cancelled).toBe(true);
    third.event({ type: 'error', error: 'TIMEOUT' });
    third.close();

    expect((await view.findByRole('alert')).textContent).toContain('הניתוח נמשך זמן רב מדי. נסו שוב בעוד רגע.');
    expect((view.getByRole('button', { name: 'ניתוח מחדש' }) as HTMLButtonElement).disabled).toBe(false);
    expect(view.getByText(insights.summary)).not.toBeNull();
  });

  test('restores the first-load action after error and aborts generation on unmount', async () => {
    const { streams, requests } = mockStreamingFetch();
    const view = render(<AiInsights />);
    fireEvent.click(view.getByRole('button', { name: '✦ נתח את הנתונים' }));
    const first = await waitForRequest(streams);
    first.event({ type: 'error', error: 'AI_INVALID_EVIDENCE' });
    first.close();

    expect((await view.findByRole('alert')).textContent).toContain('המודל החזיר תוצאה שלא עמדה בכללי ביסוס הנתונים. נסו שוב.');
    expect((view.getByRole('button', { name: '✦ נתח את הנתונים' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(view.getByRole('button', { name: '✦ נתח את הנתונים' }));
    const second = await waitForRequest(streams, 1);
    view.unmount();

    expect(requests[1]?.signal?.aborted).toBe(true);
    expect(second.cancelled).toBe(true);
  });
});

describe('management report streaming UI', () => {
  test('shows the full report skeleton, streams stages to the final report, and persists the session result', async () => {
    window.history.replaceState({}, '', '/report?channel=Google');
    const { streams, requests } = mockStreamingFetch();
    const view = render(<ReportBuilder />);

    fireEvent.click(view.getByRole('button', { name: 'יצירת דוח ניהולי' }));

    const skeleton = view.getByTestId('report-skeleton');
    expect(skeleton.getAttribute('aria-busy')).toBe('true');
    expect(skeleton.querySelector('.report-skeleton-cover')).not.toBeNull();
    expect(skeleton.querySelector('.report-skeleton-kpis')).not.toBeNull();
    expect(skeleton.querySelector('.report-skeleton-charts')).not.toBeNull();
    expect(skeleton.querySelector('.report-skeleton-ai')).not.toBeNull();
    const stream = await waitForRequest(streams);
    expect(new Headers(requests[0]?.headers).get('accept')).toBe('application/x-ndjson');
    stream.event({ type: 'progress', stage: 'generating' });
    await view.findByText('DeepSeek מנתח את הביצועים…');
    stream.event({ type: 'result', data: reportResult });
    stream.close();

    expect(await view.findByText('הדוח מוכן')).not.toBeNull();
    expect(view.getByText(insights.summary)).not.toBeNull();
    expect(JSON.parse(sessionStorage.getItem('sts-report:?channel=Google') ?? 'null'))
      .toEqual(reportResult);
  });

  test('restores a session report and retains it through regeneration failure and cancellation', async () => {
    window.history.replaceState({}, '', '/report?channel=Google');
    sessionStorage.setItem('sts-report:?channel=Google', JSON.stringify(reportResult));
    const { streams, requests } = mockStreamingFetch();
    const view = render(<ReportBuilder />);
    expect(await view.findByText('הדוח מוכן')).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'יצירה מחדש' }));
    const first = await waitForRequest(streams);
    first.event({ type: 'progress', stage: 'validating' });
    expect(await view.findByText('מאמת את התובנות מול הנתונים…')).not.toBeNull();
    expect(view.getByText(insights.summary)).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'מעדכן…' }));
    const second = await waitForRequest(streams, 1);
    expect(requests[0]?.signal?.aborted).toBe(true);
    expect(first.cancelled).toBe(true);
    second.event({ type: 'error', error: 'TIMEOUT' });
    second.close();

    expect((await view.findByRole('alert')).textContent).toContain('יצירת הדוח נמשכה זמן רב מדי. נסו שוב.');
    expect((view.getByRole('button', { name: 'יצירה מחדש' }) as HTMLButtonElement).disabled).toBe(false);
    expect(view.getByText(insights.summary)).not.toBeNull();

    fireEvent.click(view.getByRole('button', { name: 'יצירה מחדש' }));
    await waitForRequest(streams, 2);
    view.unmount();
    expect(requests[2]?.signal?.aborted).toBe(true);
  });
});
