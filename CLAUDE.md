# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`stsiconic-dashboard` — a Hebrew-first, RTL business/financial dashboard. Each user connects **their own** Google Sheets API key + spreadsheet; the app reads the sheet on demand, aggregates KPIs in memory, and renders ECharts visualizations. Sheet rows are **never persisted** — PostgreSQL stores connection configuration only.

Stack: Astro 6 SSR (`output: 'server'`) on the Vercel adapter, React 19 islands, Clerk auth, ECharts 6, Prisma Next (not classic Prisma), Zod, Bun as package manager, Node 24.

## Commands

```sh
bun install
bun run dev              # astro dev on http://127.0.0.1:4321
bun run build            # astro build (Vercel output)
bun run check            # astro check — typecheck .astro/.ts/.tsx; run this instead of tsc
bun test                 # bun:test unit tests in tests/
bun run test:e2e         # playwright; auto-starts `bun run dev`
bun run test:all         # check + unit + e2e + build
```

Single tests:

```sh
bun test tests/domain.test.ts
bun test -t "parses the 15 headers"                    # filter by test name
bunx playwright test -g "no horizontal overflow" --project=desktop-chromium
```

Playwright projects: `desktop-chromium` (1440×900) and `mobile-chromium` (Pixel 5, 390×844). Runs serially (`workers: 1`).

Database (Prisma Next CLI, config in `prisma-next.config.ts`):

```sh
bun run contract:emit    # regenerate src/prisma/contract.json + contract.d.ts from contract.prisma
bun run migration:plan   # preview migration for the current contract
bun run migrate          # apply migrations from ./migrations
bun run db:verify        # assert live DB matches the contract
```

**After any edit to `src/prisma/contract.prisma` you must run `contract:emit`** — `src/prisma/db.ts` is typed from the generated `contract.d.ts` and reads `contract.json` at runtime. Both generated files are committed.

## Environment

Copy `.env.example` → `.env.local`. Required: `PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`, `SETTINGS_ENCRYPTION_KEY` (base64 32 bytes — `openssl rand -base64 32`), `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, plus the Clerk redirect URLs. Demo Sheet defaults may be supplied with `GOOGLE_SHEETS_API`, `SHEET_ID`, and `SHEET_NAME`. Node must be 24.x locally and on Vercel (`.nvmrc`).

## Architecture

### Request flow

Browser → React island `Dashboard` → `GET /api/dashboard` → `getConnection(userId)` (Postgres) → decrypt API key → `fetchGoogleSheet` (Google Sheets v4 REST, no SDK) → `parseSheet` → `aggregateDashboard` → JSON → ECharts.

The **initial** request is not started by the island. An inline `<script is:inline slot="head">` in `dashboard.astro` fires it during HTML parse and parks the promise on `window.__dashboardPrefetch`; `Dashboard` consumes it once on mount, then deletes it. This removes ~1.5s of hydration wait from LCP. The kickoff URL must stay byte-identical to the one `load()` builds, or the island issues a duplicate request. Filter changes, manual refresh, and the poll all use the normal `fetch` path. The `head` slot is plumbed `dashboard.astro` → `AppLayout` → `BaseLayout`.

`Chart` is `React.lazy`-loaded so the ~600KB ECharts bundle stays off the KPI paint path; each chart sits in its own `<Suspense>` whose fallback is an empty `.chart-canvas` (fixed 300px) so lazy loading costs no layout shift.

`/api/dashboard` emits `Server-Timing` (`db-connection`, `sheets-fetch`, `db-mark-synced`, `aggregate`) via `createTimings()` in `src/lib/timing.ts` — use it before optimizing server latency by guesswork. `fetchGoogleSheet` issues its metadata and values calls concurrently; the error precedence (metadata transport → `WORKSHEET_NOT_FOUND` → values transport) is load-bearing and must be preserved.

`src/lib/` holds all domain logic and is framework-free — it is the layer worth testing (`tests/domain.test.ts`). API routes in `src/pages/api/` are thin: auth check, Zod parse, call `lib`, wrap with `json()`. `tests/dashboard-ssr.test.tsx` is a smoke test asserting the `Dashboard` island renders under `renderToString` without browser globals; keep new islands SSR-safe (guard `location`/`window` access in render paths).

### Auth

Clerk is wired as an Astro **integration** in `astro.config.ts` (with `heIL` localization and a dark appearance matching the design tokens). `src/middleware.ts` guards `/dashboard`, `/data-settings`, `/ai-insights`, `/questions`, `/report`, and `/api/*`, and redirects unauthenticated requests to `/sign-in?redirect_url=…`. API routes still independently re-check `locals.auth()` and return `401 UNAUTHORIZED` — keep both layers.

`src/pages/sign-in/[...rest].astro` re-renders `sign-in.astro` so Clerk's `path`-based routing (e.g. `/sign-in/sso-callback`, factor steps) resolves instead of 404ing. Don't collapse these two files.

### The Google Sheet contract

`REQUIRED_HEADERS` in `src/lib/sheets.ts` — 15 Hebrew column names — is the single source of truth for the expected worksheet shape. Parsing rules that tests depend on:

- Missing any header → throws `SCHEMA_MISMATCH` (with a `missing` list).
- Dates must be `dd/MM/yyyy` and calendar-valid; stored internally as `YYYY-MM-DD` strings, compared lexically.
- Rows with a blank ID, invalid date, or duplicate ID are skipped and counted in `skippedRows` — never surfaced as errors.
- Blank numeric cell → `null` (**distinct from `0`**) and raises the `BLANK_NUMERIC_VALUES` warning. Currency symbols/separators are stripped before parsing.
- Blank dimension cell → `'לא צוין'`.
- `parseSpreadsheetId` accepts a raw ID or a `docs.google.com/spreadsheets/d/<id>` URL, and rejects `/d/e/` published-export URLs.

### KPIs

`aggregateDashboard` defaults to the last 30 days of the data's own range and compares against an equal-length immediately-preceding window (`previousWindow`). Any ratio with a zero denominator is `null`, not `0`; the UI renders `null` as `—` / "אין נתוני השוואה". Filters are AND-ed across dimensions and OR-ed within one, and are driven entirely by URL search params (`?campaign=…&channel=…`), which the `Dashboard` island reads from `location.search` and forwards verbatim to the API.

### Security model

- Google API keys are encrypted with AES-256-GCM in `src/lib/crypto.ts`, using the **Clerk user ID as AAD** so a ciphertext cannot be replayed under another user. Format: `iv.tag.ciphertext`, base64url.
- `publicSettings()` is the only object shape ever sent to the client (masked last four digits). Never return raw rows from `SheetConnection`.
- Every JSON response goes through `json()` in `src/lib/http.ts` (`no-store`, `nosniff`).
- Mutating routes call `assertJson(request)` first — origin + `content-type` check acting as the CSRF guard.
- Outbound Google fetches use a short `AbortController` timeout. The Vercel SSR function has a 300-second `maxDuration` for bounded OpenRouter report retries and `gpt-image-2` generation.

### Error handling convention

Errors are thrown as `Object.assign(new Error(CODE), { code: CODE })` and read back with `errorCode()`. The client receives `{ error: CODE }` and maps codes to Hebrew copy. Existing codes: `SCHEMA_MISMATCH`, `INVALID_SPREADSHEET`, `WORKSHEET_NOT_FOUND`, `SPREADSHEET_NOT_FOUND`, `PERMISSION_DENIED`, `INVALID_API_KEY`, `UPSTREAM_ERROR`, `TIMEOUT`, `NOT_CONNECTED`, `UNAUTHORIZED`, `SERVER_CONFIGURATION`, `API_KEY_REQUIRED`, `INVALID_ORIGIN`, `INVALID_CONTENT_TYPE`, `INVALID_INPUT`. Add to this vocabulary rather than returning prose messages.

### Caching

`src/lib/cache.ts` is a per-process `Map`, keyed `${userId}:${connection.updatedAt}` with a 60s TTL, so saving settings implicitly invalidates. `?refresh=1` bypasses it. It is **not** shared across serverless instances — treat it as a best-effort optimization, not a coherence guarantee.

## Conventions

- **RTL/Hebrew first.** `dir="rtl"`/`lang="he"` are set once in `BaseLayout.astro`; all user-facing copy is Hebrew. Wrap Latin/numeric runs (currency, dates, IDs, API keys) in `class="ltr"` — it applies `direction:ltr; unicode-bidi:isolate` plus tabular numerals. Format numbers with `Intl` and the `he-IL` locale (`ILS` for currency).
- **Styling.** No Tailwind. Design tokens are CSS custom properties in `src/styles/global.css`; `.astro` files use scoped `<style>` blocks and React components import a co-located `.css` file. The chart palette in `Chart.tsx` must stay in sync with those tokens.
- **ECharts** is registered à la carte (`echarts/core` + explicit chart/component imports) to keep the island small — add new chart types to that `echarts.use([...])` list. `AriaComponent` is enabled with Hebrew descriptions; keep new charts accessible.
- **Islands.** Interactive React is mounted with `client:load` from `.astro` pages; keep pages as thin shells. Exception: the two `UserControl` instances in `AppLayout.astro` use `client:visible`, because the layout's own media queries `display:none` one of them at every viewport — `client:visible` means the hidden one never hydrates and never pays for Clerk's React bundle.
- `/ai-insights`, `/questions`, and `/report` are fully implemented authenticated features. Preserve strict AI grounding, visible evidence, structured-output validation, and the explicit image-generation action.

## Notes

- `AGENTS.md` is the authoritative repository guide. `README.md` documents the current architecture, data contract, AI grounding, and deployment lifecycle.
- `docs/` holds the original Hebrew requirements PDF.
- The Google Sheets source must be a **native** Google Sheet (converted from `.xlsx`), shared view-only, with a worksheet containing all 15 headers.
