import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePollingRefresh } from './usePollingRefresh';
import './dashboard.css';

// ECharts is the largest dependency on the page and none of it is needed to
// paint the KPI grid, so it is kept off the initial island bundle.
const Chart = lazy(() => import('./Chart'));

const POLL_INTERVAL_MS = 5 * 60_000; // Polls every 5 minutes, change to 10_000 for testing purposes;

type Kpi = { current: number | null; previous: number | null; delta: number | null };
type Leader = { name: string; revenue: number } | null;
type FilterKey = 'campaign' | 'channel' | 'salesperson' | 'region' | 'product';
type FilterOptions = {
  campaigns: string[];
  channels: string[];
  salespeople: string[];
  regions: string[];
  products: string[];
};
type ChartDatum = { name: string; value: number; actualSpend?: number };
type ResponseData = {
  sync: { status: string; lastSyncAt: string | null };
  validRows: number;
  skippedRows: number;
  warnings: string[];
  sourceBounds: { from: string; to: string } | null;
  appliedFilters: { from?: string; to?: string };
  filters: FilterOptions;
  kpis: Record<string, Kpi>;
  leaders: { topCampaign: Leader; topChannel: Leader };
  charts: Record<string, ChartDatum[]>;
};

const numberFormatter = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const currencyFormatter = new Intl.NumberFormat('he-IL', {
  style: 'currency',
  currency: 'ILS',
  maximumFractionDigits: 0,
});
const percentFormatter = new Intl.NumberFormat('he-IL', {
  style: 'percent',
  maximumFractionDigits: 1,
});

const kpiMeta = [
  ['revenue', 'סך הכנסות', 'currency'],
  ['actualSpend', 'סך הוצאות', 'currency'],
  ['leads', 'מספר לידים', 'number'],
  ['deals', 'מספר עסקאות', 'number'],
  ['conversionRate', 'המרה מליד לעסקה', 'percent'],
  ['costPerLead', 'עלות ממוצעת לליד', 'currency'],
  ['costPerDeal', 'עלות ממוצעת לעסקה', 'currency'],
  ['roi', 'החזר על ההשקעה', 'percent'],
] as const;

const chartMeta = [
  ['trend', 'הכנסות מול הוצאות לאורך זמן', 'מגמת ביצועים לפי יום', 'line', 'currency'],
  ['channelLeads', 'לידים לפי ערוץ פרסום', 'כמות לידים מכל ערוץ', 'bar', 'number'],
  ['campaignConversion', 'אחוזי המרה לפי קמפיין', 'עסקאות מתוך לידים', 'bar', 'percent'],
  ['salespeople', 'הכנסות לפי איש מכירות', 'ביצועי צוות המכירות', 'bar', 'currency'],
  ['products', 'ביצועים לפי מוצר או שירות', 'הכנסות לפי תחום פעילות', 'bar', 'currency'],
  ['funnel', 'משפך מכירות', 'מלידים לפגישות ולעסקאות', 'funnel', 'number'],
] as const;

const filterMeta: Array<{
  key: FilterKey;
  optionsKey: keyof FilterOptions;
  label: string;
}> = [
  { key: 'campaign', optionsKey: 'campaigns', label: 'קמפיין' },
  { key: 'channel', optionsKey: 'channels', label: 'ערוץ פרסום' },
  { key: 'salesperson', optionsKey: 'salespeople', label: 'איש מכירות' },
  { key: 'region', optionsKey: 'regions', label: 'אזור' },
  { key: 'product', optionsKey: 'products', label: 'מוצר או שירות' },
];

const errorMessages: Record<string, { title: string; body: string }> = {
  NOT_CONNECTED: {
    title: 'עדיין לא חובר מקור נתונים',
    body: 'יש לשמור חיבור תקין ל-Google Sheets לפני הצגת לוח הבקרה.',
  },
  INVALID_API_KEY: {
    title: 'מפתח Google API אינו תקין',
    body: 'בדקו את המפתח בהגדרות הנתונים ונסו שוב.',
  },
  PERMISSION_DENIED: {
    title: 'אין גישה לגיליון',
    body: 'ודאו שהגיליון זמין לקריאה וש-Google Sheets API פעיל בפרויקט.',
  },
  SPREADSHEET_NOT_FOUND: {
    title: 'הגיליון לא נמצא',
    body: 'בדקו את כתובת הגיליון או המזהה ששמרתם.',
  },
  WORKSHEET_NOT_FOUND: {
    title: 'לשונית העבודה לא נמצאה',
    body: 'בדקו את שם הלשונית, כולל רווחים ואיות.',
  },
  SCHEMA_MISMATCH: {
    title: 'מבנה הגיליון אינו תואם',
    body: 'חסרות עמודות נדרשות. ניתן למצוא את המבנה המדויק במסך הגדרות הנתונים.',
  },
  TIMEOUT: {
    title: 'הסנכרון נמשך זמן רב מדי',
    body: 'Google Sheets לא השיב בזמן. נסו לרענן שוב בעוד רגע.',
  },
  SERVER_CONFIGURATION: {
    title: 'המערכת אינה מוגדרת במלואה',
    body: 'חסר משתנה סביבה בצד השרת. יש לפנות למנהל המערכת.',
  },
};

/** Formats a KPI value for its configured number, currency, or percentage type. */
function format(value: number | null, type: string) {
  if (value == null) return '—';
  if (type === 'currency') return currencyFormatter.format(value);
  if (type === 'percent') return percentFormatter.format(value);
  return numberFormatter.format(value);
}

/** Formats an ISO calendar date for Hebrew display without shifting its UTC day. */
function displayDate(value?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('he-IL').format(new Date(`${value}T00:00:00Z`));
}

/** Renders date and multi-select controls backed by the dashboard URL parameters. */
function FilterControls({
  data,
  params,
  onDate,
  onToggle,
}: {
  data: ResponseData;
  params: URLSearchParams;
  onDate: (key: 'from' | 'to', value: string) => void;
  onToggle: (key: FilterKey, value: string, checked: boolean) => void;
}) {
  return (
    <div className="filter-controls">
      <label className="date-filter">
        <span>מתאריך</span>
        <input
          className="ltr"
          type="date"
          min={data.sourceBounds?.from}
          max={data.sourceBounds?.to}
          value={params.get('from') ?? data.appliedFilters.from ?? ''}
          onChange={(event) => onDate('from', event.target.value)}
        />
      </label>
      <label className="date-filter">
        <span>עד תאריך</span>
        <input
          className="ltr"
          type="date"
          min={data.sourceBounds?.from}
          max={data.sourceBounds?.to}
          value={params.get('to') ?? data.appliedFilters.to ?? ''}
          onChange={(event) => onDate('to', event.target.value)}
        />
      </label>
      {filterMeta.map(({ key, optionsKey, label }) => {
        const selected = params.getAll(key);
        return (
          <details className="filter-menu" key={key}>
            <summary>
              {label}
              {selected.length > 0 && <span>{selected.length}</span>}
            </summary>
            <div className="filter-options">
              {data.filters[optionsKey].map((option) => (
                <label key={option}>
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={(event) => onToggle(key, option, event.target.checked)}
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          </details>
        );
      })}
    </div>
  );
}

/** Loads and renders the filterable, polling Google Sheets analytics dashboard. */
export default function Dashboard() {
  const [data, setData] = useState<ResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState('');
  const abort = useRef<AbortController | null>(null);

  /** Loads dashboard data, superseding stale requests and optionally bypassing the cache. */
  const load = useCallback(async (bypass = false, prefetched?: Promise<Response>) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true);
    setError(null);
    try {
      /** Starts a dashboard request using the latest browser URL filters. */
      const request = () => {
        const query = window.location.search;
        return fetch(
          `/api/dashboard${query}${query ? '&' : '?'}refresh=${bypass ? '1' : '0'}`,
          { signal: controller.signal },
        );
      };
      // A prefetched request was started before this island existed and carries no
      // abort signal, so it can fail without any error UI mounted — fall back to a
      // fresh request rather than surfacing a transient network blip.
      const response = prefetched ? await prefetched.catch(request) : await request();
      const body = await response.json() as ResponseData & { error?: string };
      // A prefetched response outlives its abort signal, so drop it explicitly
      // when a filter change or manual refresh already superseded this load.
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(body.error ?? 'UPSTREAM_ERROR');
      setData(body);
    } catch (caught) {
      if ((caught as Error).name !== 'AbortError') {
        setError((caught as Error).message);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSearch(window.location.search);
    // Handed over by the inline kickoff script in dashboard.astro. Consumed once,
    // then cleared so refresh/filter/poll loads never replay a stale response.
    const prefetched = window.__dashboardPrefetch;
    delete window.__dashboardPrefetch;
    void load(false, prefetched);
    return () => {
      abort.current?.abort();
    };
  }, [load]);

  usePollingRefresh(() => { void load(); }, POLL_INTERVAL_MS);

  const params = useMemo(() => new URLSearchParams(search), [search]);
  const active = useMemo(
    () => Array.from(params.entries()).filter(([key]) => key !== 'refresh'),
    [params],
  );

  /** Writes filter parameters to browser history and reloads dashboard data. */
  const commitParams = (next: URLSearchParams) => {
    const query = next.toString();
    window.history.replaceState(null, '', query ? `${window.location.pathname}?${query}` : window.location.pathname);
    setSearch(window.location.search);
    void load();
  };

  /** Sets or removes one inclusive date boundary. */
  const onDate = (key: 'from' | 'to', value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (value) next.set(key, value);
    else next.delete(key);
    commitParams(next);
  };

  /** Adds or removes one selected dimension value while preserving its peers. */
  const onToggle = (key: FilterKey, value: string, checked: boolean) => {
    const next = new URLSearchParams(window.location.search);
    const values = next.getAll(key).filter((item) => item !== value);
    if (checked) values.push(value);
    next.delete(key);
    values.forEach((item) => next.append(key, item));
    commitParams(next);
  };

  /** Removes one active date or dimension filter chip. */
  const remove = (key: string, value: string) => {
    const next = new URLSearchParams(window.location.search);
    if (key === 'from' || key === 'to') {
      next.delete(key);
    } else {
      const values = next.getAll(key).filter((item) => item !== value);
      next.delete(key);
      values.forEach((item) => next.append(key, item));
    }
    commitParams(next);
  };

  /** Clears every dashboard filter and reloads the default date window. */
  const clearAll = () => commitParams(new URLSearchParams());

  if (loading && !data) {
    return (
      <section className="dashboard" aria-label="טוען נתונים">
        <div className="filter-skeleton" />
        <div className="kpi-grid">
          {Array.from({ length: 10 }, (_, index) => (
            <div className="card skeleton" key={index} />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    const message = errorMessages[error] ?? {
      title: 'לא הצלחנו לטעון את הנתונים',
      body: 'אירעה תקלה זמנית בחיבור למקור הנתונים. נסו שוב.',
    };
    return (
      <section className="card error-state" role="alert">
        <span aria-hidden="true">!</span>
        <h2>{message.title}</h2>
        <p>{message.body}</p>
        <div>
          <button className="btn primary" onClick={() => void load(true)}>ניסיון נוסף</button>
          {' '}
          <a className="btn" href="/data-settings">הגדרות נתונים</a>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const leaderCards: Array<{ label: string; leader: Leader }> = [
    { label: 'הקמפיין המוביל', leader: data.leaders.topCampaign },
    { label: 'ערוץ הפרסום המוביל', leader: data.leaders.topChannel },
  ];

  return (
    <section className="dashboard" aria-busy={loading}>
      <section className="filters card" aria-label="סינון וסנכרון">
        <div className="filter-topline">
          <div className="sync">
            <i />
            <span>
              סנכרון אחרון:{' '}
              {data.sync.lastSyncAt
                ? <span className="ltr">{new Date(data.sync.lastSyncAt).toLocaleString('he-IL')}</span>
                : 'טרם בוצע'}
            </span>
          </div>
          <div className="filter-actions">
            <button className="btn mobile-filter" onClick={() => setFiltersOpen(true)}>
              סינון
              {active.length > 0 && <span>{active.length}</span>}
            </button>
            <button className="btn" disabled={loading} onClick={() => void load(true)}>
              {loading ? 'מסנכרן…' : '↻ סנכרון ידני'}
            </button>
          </div>
        </div>
        <div className="desktop-filters">
          <FilterControls data={data} params={params} onDate={onDate} onToggle={onToggle} />
        </div>
      </section>

      <div className="source-strip">
        <span>
          מקור: Google Sheets · {numberFormatter.format(data.validRows)} שורות בתקופה
        </span>
        <span className="ltr">
          {displayDate(data.appliedFilters.from)} – {displayDate(data.appliedFilters.to)}
        </span>
        {data.skippedRows > 0 && <span className="warning">{data.skippedRows} שורות לא תקינות דולגו</span>}
        {data.warnings.includes('BLANK_NUMERIC_VALUES') && <span className="warning">קיימים ערכים מספריים חסרים</span>}
      </div>

      {active.length > 0 && (
        <div className="chips" aria-label="מסננים פעילים">
          {active.map(([key, value]) => (
            <button key={`${key}-${value}`} onClick={() => remove(key, value)}>
              {key === 'from' ? 'מתאריך: ' : key === 'to' ? 'עד תאריך: ' : ''}
              {value} ×
            </button>
          ))}
          <button className="clear-chip" onClick={clearAll}>איפוס כל המסננים</button>
        </div>
      )}

      <div className="kpi-grid">
        {kpiMeta.map(([key, label, type]) => {
          const metric = data.kpis[key];
          return (
            <article className="card kpi" key={key}>
              <p>{label}</p>
              <strong className="ltr">{format(metric?.current ?? null, type)}</strong>
              <small className={metric?.delta == null ? 'muted' : metric.delta >= 0 ? 'up' : 'down'}>
                {metric?.delta == null
                  ? 'אין נתוני השוואה'
                  : `${metric.delta >= 0 ? '↑' : '↓'} ${format(Math.abs(metric.delta), 'percent')} לעומת התקופה הקודמת`}
              </small>
            </article>
          );
        })}
        {leaderCards.map(({ label, leader }) => (
          <article className="card kpi leader" key={label}>
            <p>{label}</p>
            <strong><bdi dir="auto">{leader?.name ?? '—'}</bdi></strong>
            <small className="muted">
              {leader ? `${currencyFormatter.format(leader.revenue)} הכנסות` : 'אין נתונים בתקופה'}
            </small>
          </article>
        ))}
      </div>

      {data.validRows === 0 ? (
        <section className="card empty">
          <div>
            <h2>לא נמצאו נתונים</h2>
            <p>לא קיימות שורות התואמות למסננים שבחרתם.</p>
            <button className="btn primary" onClick={clearAll}>איפוס מסננים</button>
          </div>
        </section>
      ) : (
        <div className="charts">
          {chartMeta.map(([key, title, subtitle, kind, valueType]) => (
            <article className="card chart-card" key={key}>
              <header>
                <h2>{title}</h2>
                <p>{subtitle}</p>
              </header>
              {/* .chart-canvas is a fixed 300px box, so the fallback reserves the
                  exact final height and the lazy load costs no layout shift. */}
              <Suspense fallback={<div className="chart-canvas" />}>
                <Chart
                  kind={kind}
                  data={data.charts[key] ?? []}
                  label={title}
                  valueType={valueType}
                />
              </Suspense>
            </article>
          ))}
        </div>
      )}

      {filtersOpen && (
        <div className="sheet-backdrop" onMouseDown={() => setFiltersOpen(false)}>
          <section
            className="filter-sheet card"
            role="dialog"
            aria-modal="true"
            aria-label="סינון נתונים"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <p>לוח הבקרה</p>
                <h2>סינון נתונים</h2>
              </div>
              <button className="btn close-filter" aria-label="סגירת מסננים" onClick={() => setFiltersOpen(false)}>×</button>
            </header>
            <FilterControls data={data} params={params} onDate={onDate} onToggle={onToggle} />
            <footer>
              <button className="btn" onClick={clearAll}>איפוס הכול</button>
              <button className="btn primary" onClick={() => setFiltersOpen(false)}>הצגת תוצאות</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
