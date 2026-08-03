import { expect, test, type Page } from '@playwright/test';
import type { ComponentType } from 'react';

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
      evidenceKeys: [],
    },
    {
      title: 'שליטה בהוצאות',
      explanation: 'ההוצאה נשארה בגבולות היעד.',
      evidenceKeys: [],
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
      format: 'currency',
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

const reportResult = {
  report: {
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
  },
  evidence: insights.evidence,
  generatedAt: '2026-08-03T09:45:00.000Z',
  lastSyncAt: '2026-08-03T08:30:00.000Z',
};

const questionMarkdown = [
  '## מצב הביצועים',
  '',
  '**ההכנסות חזקות** ביחס לתקופה.',
  '',
  '- Google מוביל',
  '- העלות נשלטת',
  '',
  '[דוח חיצוני](https://example.com/reports/a-very-long-safe-report-url)',
  '',
  '`campaign_identifier_with_a_very_long_unbroken_value_1234567890`',
  '',
  '| מדד | ערך |',
  '| --- | ---: |',
  '| ROI | 700% |',
].join('\n');

const questionResult = {
  answer: `${questionMarkdown}\n\nהתשובה הושלמה.`,
  evidence: [],
  images: [],
  context: {
    period: { from: '2026-07-01', to: '2026-07-31' },
    rowCount: 12,
    lastSyncAt: '2026-08-03T08:30:00.000Z',
  },
};

type BrowserTestWindow = Window & {
  __finishAiTest?: () => void;
  __emitAiTest?: (event: unknown) => void;
  __aiAccept?: string | null;
  __aiAborted?: boolean;
  __aiStreamCancelled?: boolean;
  __vite_plugin_react_preamble_installed__?: boolean;
  $RefreshReg$?: () => void;
  $RefreshSig$?: () => (type: unknown) => unknown;
};

async function mountAiScreen(
  page: Page,
  options: {
    component: 'AiInsights' | 'QuestionsAgent' | 'ReportBuilder';
    pathname: '/ai-insights' | '/questions' | '/report';
    endpoint: '/api/ai/insights' | '/api/ai/questions' | '/api/ai/report';
    result: unknown;
    initialEvents?: unknown[];
  },
) {
  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.evaluate(({ component, endpoint, initialEvents, pathname, result }) => {
    const testWindow = window as BrowserTestWindow;
    const nativeFetch = window.fetch.bind(window);
    window.history.replaceState({}, '', `${pathname}?channel=Google`);
    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const inputUrl = typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
      if (new URL(inputUrl, window.location.href).pathname !== endpoint) {
        return nativeFetch(input, init);
      }
      testWindow.__aiAccept = new Headers(init?.headers).get('accept');
      testWindow.__aiAborted = false;
      testWindow.__aiStreamCancelled = false;
      init?.signal?.addEventListener('abort', () => {
        testWindow.__aiAborted = true;
      }, { once: true });
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const emit = (event: unknown) => {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          for (const event of initialEvents ?? [
            { type: 'progress', stage: 'loading-data' },
            { type: 'progress', stage: 'generating' },
          ]) emit(event);
          testWindow.__emitAiTest = emit;
          testWindow.__finishAiTest = () => {
            emit({
              type: 'result',
              data: result,
            });
            controller.close();
          };
        },
        cancel() {
          testWindow.__aiStreamCancelled = true;
        },
      }), {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
      });
    };
    window.fetch = Object.assign(mockFetch, { preconnect: window.fetch.preconnect });

    document.body.replaceChildren();
    const mount = document.createElement('main');
    mount.id = 'ai-e2e-root';
    mount.className = 'page';
    mount.dir = 'rtl';
    document.body.append(mount);

    return (async () => {
      const dynamicImport = (path: string) => import(path);
      const refresh = await dynamicImport('/@react-refresh') as {
        default: { injectIntoGlobalHook: (target: Window) => void };
      };
      refresh.default.injectIntoGlobalHook(window);
      testWindow.$RefreshReg$ = () => undefined;
      testWindow.$RefreshSig$ = () => (type) => type;
      testWindow.__vite_plugin_react_preamble_installed__ = true;
      const react = await dynamicImport('/@id/react') as {
        default: typeof import('react');
      };
      const reactDom = await dynamicImport('/@id/react-dom/client') as {
        default: typeof import('react-dom/client');
      };
      const screen = await dynamicImport(`/src/components/${component}.tsx`) as {
        default: ComponentType;
      };
      reactDom.default.createRoot(mount).render(
        react.default.createElement(screen.default),
      );
    })();
      }, options);
      return;
    } catch (error) {
      if (
        attempt > 0
        || !(error instanceof Error)
        || !error.message.includes('Execution context was destroyed')
      ) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ))).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('AI insights exposes streamed busy state and remains usable without overflow', async ({ page }) => {
  await mountAiScreen(page, {
    component: 'AiInsights',
    pathname: '/ai-insights',
    endpoint: '/api/ai/insights',
    result: insightsResult,
  });

  await page.getByRole('button', { name: '✦ נתח את הנתונים' }).click();
  const skeleton = page.getByTestId('insights-skeleton');
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  const status = page.getByRole('status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveText('AI מנתח את הביצועים…');
  expect(await status.locator('.ai-progress-pulse').evaluate((element) => (
    getComputedStyle(element).animationName
  ))).toBe('none');
  expect(await page.evaluate(() => (window as BrowserTestWindow).__aiAccept))
    .toBe('application/x-ndjson');
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => (window as BrowserTestWindow).__finishAiTest?.());
  await expect(page.getByText(insights.summary)).toBeVisible();
  await expect(page.getByRole('button', { name: 'ניתוח מחדש' })).toBeEnabled();
  await expectNoHorizontalOverflow(page);
});

test('questions agent streams safe Markdown, announces stable status, and cancels a new chat without overflow', async ({ page }) => {
  await mountAiScreen(page, {
    component: 'QuestionsAgent',
    pathname: '/questions',
    endpoint: '/api/ai/questions',
    result: questionResult,
    initialEvents: [],
  });

  await page.getByRole('button', { name: 'איזה קמפיין היה הכי רווחי?' }).click();
  const conversation = page.getByTestId('questions-conversation');
  await expect(conversation).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('status')).toHaveText('הסוכן מייצר תשובה…');
  await expect(page.getByText('בודק את הנתונים…')).toBeVisible();
  expect(await page.evaluate(() => (window as BrowserTestWindow).__aiAccept))
    .toBe('application/x-ndjson');

  await page.evaluate((text) => (window as BrowserTestWindow).__emitAiTest?.({
    type: 'text-delta',
    text,
  }), questionMarkdown);
  await expect(page.getByRole('heading', { name: 'מצב הביצועים' })).toBeVisible();
  await expect(page.locator('.message.assistant strong')).toHaveText('ההכנסות חזקות');
  await expect(page.getByText('בודק את הנתונים…')).toBeHidden();
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => (window as BrowserTestWindow).__finishAiTest?.());
  await expect(conversation.getByText('התשובה הושלמה.')).toBeVisible();
  await expect(conversation).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('status')).toHaveText('התשובה הושלמה.');
  await expectNoHorizontalOverflow(page);

  await page.getByRole('button', { name: 'שיחה חדשה' }).click();
  await page.getByRole('button', { name: 'איזה ערוץ מביא את הלידים הזולים ביותר?' }).click();
  await expect(conversation).toHaveAttribute('aria-busy', 'true');
  await page.getByRole('button', { name: 'שיחה חדשה' }).click();

  await expect.poll(() => page.evaluate(() => ({
    aborted: (window as BrowserTestWindow).__aiAborted,
    cancelled: (window as BrowserTestWindow).__aiStreamCancelled,
  }))).toEqual({ aborted: true, cancelled: true });
  await expect(conversation).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText('מה תרצו לדעת על הביצועים?')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('management report exposes its full streamed skeleton and remains usable without overflow', async ({ page }) => {
  await mountAiScreen(page, {
    component: 'ReportBuilder',
    pathname: '/report',
    endpoint: '/api/ai/report',
    result: reportResult,
  });

  await page.getByRole('button', { name: 'יצירת דוח ניהולי' }).click();
  const skeleton = page.getByTestId('report-skeleton');
  await expect(skeleton).toHaveAttribute('aria-busy', 'true');
  await expect(skeleton.locator('.report-skeleton-cover')).toBeVisible();
  await expect(skeleton.locator('.report-skeleton-kpis')).toBeVisible();
  await expect(skeleton.locator('.report-skeleton-charts')).toBeVisible();
  await expect(skeleton.locator('.report-skeleton-ai')).toBeVisible();
  await expect(skeleton.locator('.report-skeleton-ai .skeleton-card-line').first()).toBeVisible();
  const status = page.getByRole('status');
  await expect(status).toHaveText('AI מנתח את הביצועים…');
  await expectNoHorizontalOverflow(page);

  await page.evaluate(() => (window as BrowserTestWindow).__finishAiTest?.());
  await expect(page.getByText('הדוח מוכן')).toBeVisible();
  await expect(page.getByText(insights.summary)).toBeVisible();
  await expect(page.getByRole('button', { name: 'הורדת CSV' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'ייצוא PDF' })).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('sts-report:?channel=Google')))
    .not.toBeNull();
  await expectNoHorizontalOverflow(page);
});

test('management report hides regeneration progress from print and PDF output', async ({ page }) => {
  await mountAiScreen(page, {
    component: 'ReportBuilder',
    pathname: '/report',
    endpoint: '/api/ai/report',
    result: reportResult,
  });

  await page.getByRole('button', { name: 'יצירת דוח ניהולי' }).click();
  await page.evaluate(() => (window as BrowserTestWindow).__finishAiTest?.());
  await expect(page.getByText('הדוח מוכן')).toBeVisible();

  await page.getByRole('button', { name: 'יצירה מחדש' }).click();
  const progress = page.getByRole('status');
  await expect(progress).toBeVisible();

  await page.emulateMedia({ media: 'print', reducedMotion: 'reduce' });
  await expect(progress).toBeHidden();
});
