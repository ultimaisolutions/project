import {
  useState,
  type KeyboardEventHandler,
  type SyntheticEvent,
} from 'react';
import './questions-agent.css';

type ToolEvidence = { toolName: string; output: unknown };
type GeneratedImage = {
  assetId: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  title: string;
};
type Message = {
  role: 'user' | 'assistant';
  content: string;
  evidence?: ToolEvidence[];
  images?: GeneratedImage[];
};

const examples = [
  'איזה קמפיין היה הכי רווחי?',
  'מי איש המכירות עם אחוז הסגירה הגבוה ביותר?',
  'איזה ערוץ מביא את הלידים הזולים ביותר?',
  'איפה אנחנו מוציאים כסף ללא תוצאה מספקת?',
  'באיזה חודש הייתה ירידה בביצועים?',
  'מה כדאי לשפר בחודש הבא?',
];

const errorMessages: Record<string, string> = {
  NOT_CONNECTED: 'יש לחבר מקור נתונים לפני שאפשר לשאול שאלות.',
  NO_DATA: 'לא נמצאו נתונים התואמים למסננים שנבחרו.',
  AI_NOT_CONFIGURED: 'סוכן הנתונים עדיין אינו מוגדר בצד השרת.',
  AI_EMPTY_RESPONSE: 'הסוכן לא הצליח להשלים תשובה מבוססת. נסו לנסח את השאלה מחדש.',
  TIMEOUT: 'הסוכן לא השלים את התשובה בזמן. נסו שוב.',
};

const number = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const currency = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});
const percent = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/** Narrows an unknown tool result to a non-null record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Formats a tool value using the metric's number, currency, or percentage convention. */
function formatValue(metric: string, value: unknown) {
  if (typeof value !== 'number') return value == null ? 'אין נתון' : String(value);
  if (metric === 'revenue' || metric === 'spend' || metric === 'costPerLead' || metric === 'currency') {
    return currency.format(value);
  }
  if (metric === 'conversionRate' || metric === 'roi' || metric === 'percent') return percent.format(value);
  return number.format(value);
}

/** Renders the structured tool evidence that supports an assistant answer. */
function EvidencePanel({ evidence }: { evidence: ToolEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <details className="answer-evidence">
      <summary>הנתונים שעליהם התשובה מבוססת</summary>
      <div>
        {evidence.map((item, index) => {
          const output = isRecord(item.output) ? item.output : {};
          if (Array.isArray(output.results)) {
            const metric = typeof output.metric === 'string' ? output.metric : '';
            return (
              <section key={`${item.toolName}-${index}`}>
                <h4>{String(output.dimensionLabel ?? 'דירוג')} · {String(output.metricLabel ?? metric)}</h4>
                <table>
                  <thead><tr><th>שם</th><th>ערך</th><th>הכנסות</th><th>הוצאות</th></tr></thead>
                  <tbody>
                    {output.results.filter(isRecord).map((row, rowIndex) => (
                      <tr key={`${String(row.name)}-${rowIndex}`}>
                        <td>{String(row.name)}</td>
                        <td className="ltr">{formatValue(metric, row.value)}</td>
                        <td className="ltr">{formatValue('revenue', row.revenue)}</td>
                        <td className="ltr">{formatValue('spend', row.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            );
          }
          if (Array.isArray(output.months)) {
            const metric = typeof output.metric === 'string' ? output.metric : '';
            return (
              <section key={`${item.toolName}-${index}`}>
                <h4>השוואה חודשית</h4>
                <div className="evidence-pills">
                  {output.months.filter(isRecord).map((month) => (
                    <span key={String(month.month)}>
                      <b className="ltr">{String(month.month)}</b>
                      <em className="ltr">{formatValue(metric, month.value)}</em>
                    </span>
                  ))}
                </div>
              </section>
            );
          }
          if (Array.isArray(output.evidence)) {
            return (
              <section key={`${item.toolName}-${index}`}>
                <h4>מדדים מרכזיים</h4>
                <div className="evidence-pills">
                  {output.evidence.filter(isRecord).map((fact) => (
                    <span key={String(fact.key)}>
                      <b>{String(fact.label)}</b>
                      <em className="ltr">{formatValue(String(fact.format), fact.value)}</em>
                    </span>
                  ))}
                </div>
              </section>
            );
          }
          if (Array.isArray(output.daily)) {
            return (
              <section key={`${item.toolName}-${index}`}>
                <h4>מגמה יומית</h4>
                <p>{output.daily.length} נקודות נתונים מהתקופה שנבחרה.</p>
              </section>
            );
          }
          if (typeof output.assetId === 'string') {
            return (
              <section key={`${item.toolName}-${index}`}>
                <h4>{String(output.title ?? 'תמונה נוצרה')}</h4>
                <p>{String(output.prompt ?? '')}</p>
              </section>
            );
          }
          return null;
        })}
      </div>
    </details>
  );
}

/** Provides a conversational analytics agent with grounded evidence and generated images. */
export default function QuestionsAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Sends a bounded conversation and the active filters to the questions API. */
  const ask = async (question: string) => {
    const clean = question.trim();
    if (!clean || loading) return;
    const userMessage: Message = { role: 'user', content: clean };
    const conversation = [...messages, userMessage].slice(-19);
    setMessages(conversation);
    setInput('');
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: window.location.search,
          messages: conversation.map(({ role, content }) => ({ role, content })),
        }),
      });
      const body = await response.json() as {
        answer?: string;
        evidence?: ToolEvidence[];
        images?: GeneratedImage[];
        error?: string;
      };
      if (!response.ok || !body.answer) throw new Error(body.error ?? 'AI_ERROR');
      setMessages((current) => [...current, {
        role: 'assistant',
        content: body.answer!,
        evidence: body.evidence ?? [],
        images: body.images ?? [],
      }]);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  /** Submits the current composer text without navigating away. */
  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    void ask(input);
  };

  /** Sends on Enter while preserving Shift+Enter for multiline questions. */
  const onKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(input);
    }
  };

  return (
    <section className="questions-shell card">
      <header className="questions-header">
        <div>
          <p className="eyebrow">סוכן נתונים</p>
          <h2>שאלה חופשית, תשובה מבוססת</h2>
          <p>הסוכן מפעיל כלים על מדדים מחושבים ושולח את התוצאות ל-OpenRouter; אין למודל גישה ישירה לגיליון.</p>
        </div>
        {messages.length > 0 && (
          <button className="btn" onClick={() => { setMessages([]); setError(null); }}>שיחה חדשה</button>
        )}
      </header>

      <div className="conversation" aria-live="polite">
        {messages.length === 0 && (
          <div className="question-starter">
            <div className="agent-mark" aria-hidden="true">?</div>
            <h3>מה תרצו לדעת על הביצועים?</h3>
            <p>אפשר לבחור שאלה לדוגמה או לכתוב שאלה משלכם.</p>
            <div className="example-grid">
              {examples.map((example) => (
                <button key={example} onClick={() => void ask(example)}>{example}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => (
          <article className={`message ${message.role}`} key={`${message.role}-${index}`}>
            <span className="message-role">{message.role === 'user' ? 'אתם' : 'סוכן STS'}</span>
            <p>{message.content}</p>
            {message.images?.map((generated) => (
              <figure className="agent-image" key={generated.assetId}>
                <img
                  src={`data:${generated.mimeType};base64,${generated.imageBase64}`}
                  alt={generated.title}
                />
                <figcaption>
                  <span>{generated.title}</span>
                  <a
                    className="btn"
                    href={`data:${generated.mimeType};base64,${generated.imageBase64}`}
                    download={`sts-iconic-${generated.assetId}.webp`}
                  >
                    הורדת תמונה
                  </a>
                </figcaption>
              </figure>
            ))}
            {message.role === 'assistant' && <EvidencePanel evidence={message.evidence ?? []} />}
          </article>
        ))}
        {loading && (
          <article className="message assistant loading-message">
            <span className="message-role">סוכן STS</span>
            <p><span /><span /><span /> בודק את הנתונים…</p>
          </article>
        )}
      </div>

      {error && <div className="question-error" role="alert">{errorMessages[error] ?? 'לא הצלחנו לקבל תשובה. נסו שוב.'}</div>}

      <form className="question-composer" onSubmit={submit}>
        <label className="sr-only" htmlFor="business-question">שאלה על הנתונים</label>
        <textarea
          id="business-question"
          rows={2}
          maxLength={2_000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="למשל: איזה ערוץ מביא את הלידים הזולים ביותר?"
          disabled={loading}
        />
        <button className="btn primary" disabled={loading || !input.trim()} aria-label="שליחת שאלה">
          שליחה
        </button>
      </form>
      <p className="composer-note">Enter לשליחה · Shift+Enter לשורה חדשה</p>
    </section>
  );
}
