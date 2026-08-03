import './setup-dom';
import { afterEach, describe, expect, test } from 'bun:test';
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';

const { default: QuestionsAgent } = await import('../src/components/QuestionsAgent');

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

class PendingQuestionStream {
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

function mockQuestionFetch() {
  const streams: PendingQuestionStream[] = [];
  const requests: RequestInit[] = [];
  globalThis.fetch = Object.assign(
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      const stream = new PendingQuestionStream();
      streams.push(stream);
      requests.push(init ?? {});
      return stream.response;
    },
    { preconnect: originalFetch.preconnect },
  );
  return { streams, requests };
}

async function submitQuestion(view: ReturnType<typeof render>, question: string) {
  fireEvent.click(view.getByRole('button', { name: question }));
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.history.replaceState({}, '', '/');
});

describe('questions agent streaming and Markdown UI', () => {
  test('renders partial safe Markdown and reconciles metadata into the same assistant bubble', async () => {
    window.history.replaceState({}, '', '/questions?channel=Google');
    const { streams, requests } = mockQuestionFetch();
    const view = render(<QuestionsAgent />);
    const markdown = [
      '## מצב הביצועים',
      '',
      '**הכנסות חזקות**',
      '',
      '- ערוץ מוביל',
      '- עלות נשלטת',
      '',
      '[דוח חיצוני](https://example.com/report)',
      '',
      '`ROI = 700%`',
      '',
      '| מדד | ערך |',
      '| --- | ---: |',
      '| ROI | 700% |',
      '',
      '<span>private raw html</span>',
    ].join('\n');

    await submitQuestion(view, 'איזה קמפיין היה הכי רווחי?');
    await waitFor(() => expect(streams).toHaveLength(1));

    expect(new Headers(requests[0]?.headers).get('accept')).toBe('application/x-ndjson');
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(view.getByText('בודק את הנתונים…')).not.toBeNull();
    expect(view.getByTestId('questions-conversation').getAttribute('aria-busy')).toBe('true');
    expect(view.getByRole('status').textContent).toBe('הסוכן מייצר תשובה…');

    streams[0]!.event({ type: 'text-delta', text: markdown });

    const heading = await view.findByRole('heading', { name: 'מצב הביצועים' });
    const partialBubble = heading.closest('article');
    expect(partialBubble?.classList.contains('assistant')).toBe(true);
    expect(partialBubble?.querySelector('strong')?.textContent).toBe('הכנסות חזקות');
    expect(partialBubble?.textContent).not.toContain('**');
    expect(partialBubble?.querySelectorAll('li')).toHaveLength(2);
    expect(partialBubble?.querySelector('a')?.getAttribute('href')).toBe('https://example.com/report');
    expect(partialBubble?.querySelector('a')?.getAttribute('rel')).toContain('noopener');
    expect(partialBubble?.querySelector('code')?.getAttribute('dir')).toBe('ltr');
    expect(partialBubble?.querySelector('table')).not.toBeNull();
    expect(partialBubble?.querySelector('.assistant-markdown span')).toBeNull();
    expect(view.queryByText('בודק את הנתונים…')).toBeNull();

    const userBubble = view.getByText('איזה קמפיין היה הכי רווחי?').closest('article');
    expect(userBubble?.classList.contains('user')).toBe(true);
    expect(userBubble?.querySelector('strong')).toBeNull();

    streams[0]!.event({
      type: 'result',
      data: {
        answer: `${markdown}\n\nתשובה הושלמה.`,
        evidence: [{
          toolName: 'overview',
          output: {
            evidence: [{
              key: 'kpi.revenue.current',
              label: 'סך הכנסות בתקופה',
              value: 8_000,
              format: 'currency',
            }],
          },
        }],
        images: [],
        context: {
          period: { from: '2026-07-01', to: '2026-07-31' },
          rowCount: 12,
          lastSyncAt: '2026-08-03T08:30:00.000Z',
        },
      },
    });
    streams[0]!.close();

    expect(await view.findByText('תשובה הושלמה.')).not.toBeNull();
    const completedBubble = view.getByText('תשובה הושלמה.').closest('article');
    expect(completedBubble).toBe(partialBubble);
    expect(completedBubble?.querySelector('.answer-evidence')).not.toBeNull();
    await waitFor(() => {
      expect(view.getByTestId('questions-conversation').getAttribute('aria-busy')).toBe('false');
      expect(view.getByRole('status').textContent).toBe('התשובה הושלמה.');
    });
  });

  test('discards a partial assistant answer after a sanitized stream failure', async () => {
    const { streams } = mockQuestionFetch();
    const view = render(<QuestionsAgent />);

    await submitQuestion(view, 'באיזה חודש הייתה ירידה בביצועים?');
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.event({ type: 'text-delta', text: 'תשובה חלקית שלא תישאר' });
    expect(await view.findByText('תשובה חלקית שלא תישאר')).not.toBeNull();
    streams[0]!.event({ type: 'error', error: 'TIMEOUT' });
    streams[0]!.close();

    expect((await view.findByRole('alert')).textContent)
      .toContain('הסוכן לא השלים את התשובה בזמן. נסו שוב.');
    expect(view.queryByText('תשובה חלקית שלא תישאר')).toBeNull();
    expect(view.getByText('באיזה חודש הייתה ירידה בביצועים?')).not.toBeNull();
    expect(view.getByTestId('questions-conversation').getAttribute('aria-busy')).toBe('false');
  });

  test('new conversation and unmount abort active generation without stale messages', async () => {
    const { streams, requests } = mockQuestionFetch();
    const view = render(<QuestionsAgent />);

    await submitQuestion(view, 'מה כדאי לשפר בחודש הבא?');
    await waitFor(() => expect(streams).toHaveLength(1));
    fireEvent.click(view.getByRole('button', { name: 'שיחה חדשה' }));

    await waitFor(() => {
      expect(requests[0]?.signal?.aborted).toBe(true);
      expect(streams[0]?.cancelled).toBe(true);
    });
    expect(view.container.querySelector('.message.user')).toBeNull();
    expect(view.getByText('מה תרצו לדעת על הביצועים?')).not.toBeNull();

    await submitQuestion(view, 'איזה ערוץ מביא את הלידים הזולים ביותר?');
    await waitFor(() => expect(streams).toHaveLength(2));
    view.unmount();

    await waitFor(() => expect(requests[1]?.signal?.aborted).toBe(true));
  });
});
