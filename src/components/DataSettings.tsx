import { useEffect, useState, type SyntheticEvent } from 'react';
import './data-settings.css';

type Settings = {
  apiKeyConfigured: boolean;
  maskedApiKey: string | null;
  spreadsheetId: string;
  worksheetName: string;
  status: string;
  lastTestedAt: string | null;
  lastSyncAt: string | null;
  lastErrorCode: string | null;
  serverDefaultsAvailable: boolean;
  connectionSource: 'environment' | 'user' | 'none';
};

const requiredHeaders = [
  'מזהה שורה',
  'תאריך',
  'שם קמפיין',
  'ערוץ פרסום',
  'תקציב',
  'סכום שהוצא בפועל',
  'חשיפות',
  'קליקים',
  'לידים',
  'פגישות',
  'עסקאות',
  'הכנסות',
  'איש מכירות',
  'אזור',
  'מוצר או שירות',
];

const errorMessages: Record<string, string> = {
  API_KEY_REQUIRED: 'יש להזין מפתח Google Sheets API.',
  INVALID_API_KEY: 'מפתח ה-API אינו תקין או ש-Google Sheets API אינו פעיל.',
  OFFICE_FILE_UNSUPPORTED: 'הקובץ הוא חוברת Office. יש לפתוח אותו ב-Google Drive ולשמור כגיליון Google מקורי.',
  INVALID_SPREADSHEET: 'כתובת הגיליון או המזהה אינם תקינים.',
  SPREADSHEET_NOT_FOUND: 'הגיליון לא נמצא. בדקו את המזהה ואת הרשאות הקריאה.',
  WORKSHEET_NOT_FOUND: 'שם לשונית העבודה לא נמצא בגיליון.',
  PERMISSION_DENIED: 'אין למפתח הרשאת קריאה לגיליון הזה.',
  SCHEMA_MISMATCH: 'מבנה הגיליון אינו תואם לרשימת העמודות הנדרשת.',
  TIMEOUT: 'Google Sheets לא השיב בזמן. נסו שוב בעוד רגע.',
  SERVER_CONFIGURATION: 'חסר מפתח ההצפנה בצד השרת.',
  SERVER_SHEET_NOT_CONFIGURED: 'מקור הנתונים המשותף אינו מוגדר בסביבה הזו.',
  INVALID_INPUT: 'יש להשלים את כל השדות ולבדוק את הערכים.',
};

/** Manages the user's encrypted, read-only Google Sheets connection settings. */
export default function DataSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [spreadsheet, setSpreadsheet] = useState('');
  const [worksheet, setWorksheet] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'default' | 'delete' | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  /** Loads the user's public, secret-free connection settings into the form. */
  const loadSettings = async () => {
    setLoadError(false);
    try {
      const response = await fetch('/api/data-settings');
      const data = await response.json() as Settings;
      if (!response.ok) throw new Error();
      setSettings(data);
      setSpreadsheet(data.spreadsheetId);
      setWorksheet(data.worksheetName);
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  /** Builds the connection payload, omitting a blank key so an existing key is retained. */
  const payload = () => ({
    apiKey: apiKey || undefined,
    spreadsheetId: spreadsheet,
    worksheetName: worksheet,
  });

  /** Tests, saves, or attaches server-default connection settings and reports the outcome. */
  const action = async (kind: 'test' | 'save' | 'default') => {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(
        kind === 'test' ? '/api/data-settings/test' : '/api/data-settings',
        {
          method: kind === 'test' ? 'POST' : 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(kind === 'default'
            ? { useServerDefaults: true }
            : payload()),
        },
      );
      const data = await response.json() as Settings & {
        error?: string;
        validRows?: number;
        skippedRows?: number;
      };
      if (!response.ok) throw new Error(data.error ?? 'UPSTREAM_ERROR');
      if (kind === 'test') {
        setMessage({
          type: 'success',
          text: `החיבור תקין: ${data.validRows ?? 0} שורות נקראו${data.skippedRows ? `, ${data.skippedRows} שורות דולגו` : ''}.`,
        });
      } else {
        setSettings(data);
        setSpreadsheet(data.spreadsheetId);
        setWorksheet(data.worksheetName);
        setApiKey('');
        setMessage({
          type: 'success',
          text: kind === 'default'
            ? 'ברירת המחדל של המערכת שוחזרה בהצלחה.'
            : 'החיבור נשמר בהצלחה.',
        });
      }
    } catch (caught) {
      const code = (caught as Error).message;
      setMessage({
        type: 'error',
        text: errorMessages[code] ?? 'לא הצלחנו להשלים את הפעולה. בדקו את הפרטים ונסו שוב.',
      });
    } finally {
      setBusy(null);
    }
  };

  /** Prevents native form navigation and saves the current connection fields. */
  const submit = (event: SyntheticEvent<HTMLFormElement, SubmitEvent>) => {
    event.preventDefault();
    void action('save');
  };

  /** Confirms and removes the user's stored connection, then clears local form state. */
  const disconnect = async () => {
    if (!confirm('לנתק את מקור הנתונים מהחשבון? ניתן לחבר שוב או לשחזר את ברירת המחדל.')) return;
    setBusy('delete');
    setMessage(null);
    try {
      const response = await fetch('/api/data-settings', { method: 'DELETE' });
      const data = await response.json() as Settings;
      if (!response.ok) throw new Error();
      setSettings(data);
      setApiKey('');
      setSpreadsheet(data.spreadsheetId);
      setWorksheet(data.worksheetName);
      setMessage({ type: 'success', text: 'מקור הנתונים נותק מהחשבון.' });
    } catch {
      setMessage({ type: 'error', text: 'ניתוק מקור הנתונים נכשל. נסו שוב.' });
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <section className="card settings-load-error" role="alert">
        <h2>לא הצלחנו לטעון את הגדרות הנתונים</h2>
        <p>בדקו את החיבור למסד הנתונים ונסו שוב.</p>
        <button className="btn primary" onClick={() => void loadSettings()}>ניסיון נוסף</button>
      </section>
    );
  }

  if (!settings) {
    return (
      <div className="settings-grid" aria-label="טוען הגדרות">
        <div className="card settings-card skeleton-settings" />
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="settings-grid">
        <form className="card settings-card" onSubmit={submit}>
          <header>
            <div>
              <h2>חיבור ל-Google Sheets</h2>
              <p>הנתונים נקראים ישירות מגיליון Google מקורי ובמצב קריאה בלבד.</p>
            </div>
            <span className={`status ${settings.status.toLowerCase()}`}>
              <i />
              {settings.status === 'CONNECTED'
                ? settings.connectionSource === 'environment'
                  ? 'מקור מערכת'
                  : 'חיבור מותאם'
                : settings.status === 'FAILED'
                  ? 'חיבור נכשל'
                  : 'מנותק'}
            </span>
          </header>
          <label>
            מפתח Google Sheets API
            <span className="field">
              <input
                className="ltr"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings.maskedApiKey ?? 'AIza…'}
              />
              <small>
                {settings.apiKeyConfigured
                  ? settings.connectionSource === 'environment'
                    ? 'השארת השדה ריק תשתמש במפתח המוגן של המערכת.'
                    : 'השארת השדה ריק תשמור את המפתח המוצפן הקיים.'
                  : 'המפתח יוצפן בשרת ולעולם לא יוצג שוב.'}
              </small>
            </span>
          </label>
          <label>
            כתובת גיליון או מזהה
            <span className="field">
              <input
                className="ltr"
                value={spreadsheet}
                onChange={(event) => setSpreadsheet(event.target.value)}
                required
                placeholder="https://docs.google.com/spreadsheets/d/…"
              />
            </span>
          </label>
          <label>
            שם לשונית עבודה
            <span className="field">
              <input
                value={worksheet}
                onChange={(event) => setWorksheet(event.target.value)}
                required
                placeholder="נתונים"
              />
            </span>
          </label>
          {message && (
            <div className={`notice ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
              {message.text}
            </div>
          )}
          <footer>
            <button className="btn" type="button" disabled={!!busy} onClick={() => void action('test')}>
              {busy === 'test' ? 'בודק…' : 'בדיקת חיבור'}
            </button>
            <button className="btn primary" disabled={!!busy}>
              {busy === 'save' ? 'שומר ובודק…' : 'שמירת חיבור'}
            </button>
            {settings.serverDefaultsAvailable && settings.connectionSource !== 'environment' && (
              <button className="btn restore-default" type="button" disabled={!!busy} onClick={() => void action('default')}>
                {busy === 'default' ? 'משחזר…' : 'שחזור ברירת מחדל'}
              </button>
            )}
            {settings.connectionSource !== 'none' && (
              <button className="btn danger disconnect" type="button" disabled={!!busy} onClick={() => void disconnect()}>
                {busy === 'delete' ? 'מנתק…' : 'ניתוק'}
              </button>
            )}
          </footer>
        </form>

        <aside className="settings-aside">
          <section className="card info-card">
            <h2>מצב מקור הנתונים</h2>
            <dl className="source-status">
              <div><dt>מקור</dt><dd>{settings.connectionSource === 'environment' ? 'ברירת מחדל' : settings.connectionSource === 'user' ? 'מותאם אישית' : 'מנותק'}</dd></div>
              <div><dt>לשונית</dt><dd>{settings.worksheetName || 'טרם הוגדרה'}</dd></div>
              <div>
                <dt>בדיקת חיבור</dt>
                <dd className="ltr">{settings.lastTestedAt ? new Date(settings.lastTestedAt).toLocaleString('he-IL') : 'טרם נבדק'}</dd>
              </div>
              <div>
                <dt>סנכרון אחרון</dt>
                <dd className="ltr">{settings.lastSyncAt ? new Date(settings.lastSyncAt).toLocaleString('he-IL') : 'טרם סונכרן'}</dd>
              </div>
            </dl>
          </section>
           {/*I commented out this section because it's not actually needed here, might add it somewhere else later. */}
          {/* <section className="card info-card">
            <h2>אבטחה ופרטיות</h2>
            <ul>
              <li><b>קריאה בלבד</b><span>המערכת אינה משנה תוכן בגיליון.</span></li>
              <li><b>הצפנה בשרת</b><span>המפתח נשמר בהצפנת AES-256-GCM אישית.</span></li>
              <li><b>ללא שמירת שורות</b><span>מסד הנתונים שומר הגדרות חיבור בלבד.</span></li>
            </ul>
          </section> */}
          <section className="card info-card">
            <details className="card schema-card">
            <summary>מבנה הגיליון הנדרש · {requiredHeaders.length} עמודות</summary>
            <p>שורת הכותרות חייבת לכלול את השמות הבאים. מותר להוסיף עמודות נוספות.</p>
            <div>{requiredHeaders.map((header) => <code key={header}>{header}</code>)}</div>
            </details>
          </section>
        </aside>
      </div>

      
    </div>
  );
}
