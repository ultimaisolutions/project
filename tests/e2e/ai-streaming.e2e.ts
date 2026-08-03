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

type BrowserTestWindow = Window & {
  __finishAiTest?: () => void;
  __aiAccept?: string | null;
  __vite_plugin_react_preamble_installed__?: boolean;
  $RefreshReg$?: () => void;
  $RefreshSig$?: () => (type: unknown) => unknown;
};

async function mountAiScreen(
  page: Page,
  options: {
    component: 'AiInsights' | 'ReportBuilder';
    pathname: '/ai-insights' | '/report';
    endpoint: '/api/ai/insights' | '/api/ai/report';
    result: unknown;
  },
) {
  await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ component, endpoint, pathname, result }) => {
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
      const encoder = new TextEncoder();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'progress',
            stage: 'loading-data',
          })}\n`));
          controller.enqueue(encoder.encode(`${JSON.stringify({
            type: 'progress',
            stage: 'generating',
          })}\n`));
          testWindow.__finishAiTest = () => {
            controller.enqueue(encoder.encode(`${JSON.stringify({
              type: 'result',
              data: result,
            })}\n`));
            controller.close();
          };
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
  await expect(status).toHaveText('DeepSeek מנתח את הביצועים…');
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
  await expect(status).toHaveText('DeepSeek מנתח את הביצועים…');
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
