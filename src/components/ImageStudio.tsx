import { useState } from 'react';
import type { ImageType } from '../lib/ai/image';
import './image-studio.css';

type ImageResult = {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  title: string;
};

const types: Array<{
  value: ImageType;
  title: string;
  description: string;
  icon: string;
}> = [
  { value: 'cover', title: 'שער לדוח', description: 'תמונת שער ממותגת לדוח התקופתי', icon: '▤' },
  { value: 'summary', title: 'סיכום ויזואלי', description: 'קומפוזיציה שממחישה את תמונת הביצועים', icon: '◫' },
  { value: 'campaign', title: 'קמפיין מוביל', description: 'תמונה שיווקית בהשראת הקמפיין המוביל', icon: '↗' },
  { value: 'product', title: 'מוצר מוביל', description: 'תמונה שיווקית בהשראת המוצר או השירות המוביל', icon: '◈' },
  { value: 'achievement', title: 'הישג מרכזי', description: 'גרפיקה שמדגישה את תוצאת התקופה', icon: '◆' },
];

const errors: Record<string, string> = {
  NOT_CONNECTED: 'יש לחבר מקור נתונים לפני יצירת תמונה.',
  NO_DATA: 'אין נתונים בתקופה שנבחרה ליצירת תמונה.',
  AI_NOT_CONFIGURED: 'מודל ניסוח ה-Prompt עדיין אינו מוגדר.',
  IMAGE_NOT_CONFIGURED: 'שירות יצירת התמונות עדיין אינו מוגדר בצד השרת.',
  IMAGE_GENERATION_FAILED: 'OpenAI לא הצליח ליצור את התמונה. נסו שוב או בחרו סוג אחר.',
  IMAGE_EMPTY_RESPONSE: 'שירות התמונות לא החזיר קובץ תקין. נסו שוב.',
  TIMEOUT: 'יצירת התמונה נמשכה זמן רב מדי. נסו שוב.',
};

/** Provides data-grounded image generation and download controls. */
export default function ImageStudio() {
  const [type, setType] = useState<ImageType>('cover');
  const [result, setResult] = useState<ImageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Generates the selected image type using analytics from the current URL filters. */
  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: window.location.search, type }),
      });
      const body = await response.json() as { image?: ImageResult; error?: string };
      if (!response.ok || !body.image) throw new Error(body.error ?? 'IMAGE_GENERATION_FAILED');
      setResult(body.image);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="card image-studio" data-print-hidden>
      <header>
        <div>
          <p className="eyebrow">OPENAI · GPT-IMAGE-2</p>
          <h2>סטודיו תמונות מבוסס נתונים</h2>
          <p>המערכת מנסחת Prompt מתוך נתוני התקופה ורק לאחר מכן יוצרת תמונה חדשה.</p>
        </div>
        <span className="image-badge">AI IMAGE</span>
      </header>

      <div className="image-studio-grid">
        <div className="image-controls">
          <fieldset>
            <legend>מה תרצו ליצור?</legend>
            <div className="image-type-grid">
              {types.map((option) => (
                <label className={type === option.value ? 'selected' : ''} key={option.value}>
                  <input
                    type="radio"
                    name="image-type"
                    value={option.value}
                    checked={type === option.value}
                    onChange={() => setType(option.value)}
                  />
                  <b aria-hidden="true">{option.icon}</b>
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {error && <div className="image-error" role="alert">{errors[error] ?? 'יצירת התמונה נכשלה. נסו שוב.'}</div>}
          <button className="btn primary image-generate" disabled={loading} onClick={() => void generate()}>
            {loading ? 'מנסח Prompt ומייצר תמונה…' : result ? 'יצירת גרסה חדשה' : 'יצירת תמונה'}
          </button>
          <small className="image-note">מדדים מסוכמים נשלחים ל-OpenRouter לניסוח ה-Prompt ול-OpenAI ליצירת התמונה; מפתחות ומזהים אינם נשלחים.</small>
        </div>

        <div className="image-preview">
          {result ? (
            <>
              <img
                src={`data:${result.mimeType};base64,${result.imageBase64}`}
                alt={result.title}
              />
              <div className="image-preview-actions">
                <div>
                  <strong>{result.title}</strong>
                  <details>
                    <summary>הצגת ה-Prompt שנשלח</summary>
                    <p className="ltr">{result.prompt}</p>
                  </details>
                </div>
                <a
                  className="btn primary"
                  href={`data:${result.mimeType};base64,${result.imageBase64}`}
                  download={`sts-iconic-${type}.webp`}
                >
                  הורדת תמונה
                </a>
              </div>
            </>
          ) : (
            <div className="image-placeholder">
              <span aria-hidden="true">{loading ? '◌' : '✦'}</span>
              <strong>{loading ? 'התמונה נוצרת כעת' : 'התמונה תופיע כאן'}</strong>
              <p>{loading ? 'התהליך עשוי להימשך כשתי דקות.' : 'בחרו סוג תמונה והפעילו יצירה.'}</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
