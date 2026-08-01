# STSICONIC implementation and acceptance plan

This plan is derived from `docs/משימת בית - STSICONIC.pdf` and the current repository state. The PDF is the product acceptance source of truth; `AGENTS.md` supplies the architecture, security, and verification constraints.

## Product invariants

- Hebrew-first, RTL, responsive at desktop and 390 px without horizontal overflow.
- Clerk owns identity. Every application page and `/api/*` route is authenticated, and user identity comes only from Clerk server auth.
- Google Sheets v4 is read-only and is the sole analytics source. No CSV/Excel upload, hard-coded business results, or persisted worksheet rows.
- PostgreSQL stores only each Clerk user's encrypted Sheet connection settings. Google API keys use AES-256-GCM with the Clerk user ID as authenticated additional data.
- AI receives only a compact, deterministic, server-built snapshot of the currently selected Sheet data. Numeric claims returned to users must include machine-derived evidence.
- Provider credentials stay server-side and errors exposed to the UI are sanitized Hebrew messages.

## Ground-truth gap audit

| Area | Current evidence | Required outcome |
| --- | --- | --- |
| Authentication | Clerk middleware, sign-in route, protected pages/API routes exist | Verify sign-up, sign-in, redirect, refresh persistence, and sign-out through Chrome |
| Sheet settings | Encrypted per-user persistence and connection test exist | Add actionable Hebrew errors, robust loading/failure states, source and last-sync display, and working local/Vercel env configuration |
| Sheet ingestion | Native Sheets API, 15-header parser, duplicate-ID skipping, and refresh cache exist | Preserve blank-versus-zero semantics; verify changed/new Sheet rows appear after manual refresh without duplicates |
| Dashboard KPIs | Partial KPI aggregation exists | Add all required KPIs: spend, revenue, leads, deals, lead-to-deal conversion, CPL, cost/deal, ROI, leading campaign, leading channel |
| Dashboard charts | Six charts exist but several use the wrong dimensions/measures | Provide revenue vs spend trend, leads/channel, conversion/campaign, revenue/salesperson, product performance, and funnel |
| Filters | API accepts filters; UI only shows URL chips and a placeholder mobile sheet | Build real date, campaign, channel, salesperson, region, and product/service controls plus clear-all; all KPIs/charts update |
| AI insights | Placeholder page only | Add “נתח את הנתונים”, grounded structured output, three insights, trends, anomalies, exceptional campaigns/salespeople, recommendations, and follow-up checks |
| Free questions | Placeholder page only | Add multi-turn Hebrew agent UI using Vercel AI SDK and OpenRouter `deepseek/deepseek-v4-flash`; tools query deterministic Sheet-derived facts and return visible evidence |
| Management report | Absent | Add dedicated report view with period, KPIs, performance summary, insights, anomalies, recommendations, central charts, CSV download, and print/PDF export |
| Image generation | Absent | Generate an AI-authored prompt from real performance facts, call OpenAI `gpt-image-2`, display result, and provide download; expose image generation as an agent tool |
| Resilience | Partial loading/error/empty UI | Cover missing data, Sheets/API-key/schema failures, AI failures, image failures, timeouts, retries, and clear progress states |
| Documentation/deployment | Minimal README and Vercel config | Document transformations, KPI formulas, Sheet schema/link, architecture, APIs, grounding, envs, local/deploy steps, and demo credentials handoff; configure Vercel development/preview values and verify pull |
| Automated coverage | Eight unit tests and three unauthenticated Playwright checks | Add domain/API/SSR regressions and browser acceptance for authenticated desktop/mobile workflows |

## Architecture

### Shared data pipeline

1. Resolve the authenticated user's `SheetConnection`.
2. Decrypt the Google key server-side and fetch metadata plus worksheet values from Google Sheets v4.
3. Validate the exact 15-header contract and normalize dates, dimensions, and nullable numerics.
4. Keep a short-lived per-user/revision in-memory cache; manual refresh bypasses it. Never persist rows.
5. Apply one deterministic filter engine used by dashboard, AI context, questions, reports, and image prompts.
6. Return only typed, non-secret DTOs with sanitized error codes.

### AI grounding

- Use the official `@openrouter/sdk` for strict structured insights/reports, and `ai` with `@openrouter/ai-sdk-provider` for the tool-loop question agent and image-prompt drafting. Construct every client only on the server from `OPENROUTER_API_KEY`.
- Use model `deepseek/deepseek-v4-flash`.
- Build a bounded `AnalyticsSnapshot` from deterministic aggregation: selected period, KPI values and prior-period deltas, ranked breakdowns, funnel, anomalies, row count, source metadata, and applied filters.
- Insights and reports use schema-validated structured output. The question agent uses tools that answer from the snapshot rather than giving the model unrestricted data access.
- Every response exposes an evidence list containing the exact derived metrics/dimensions used. Reject or retry structurally invalid output; never silently substitute canned business content.

### Image generation

- The text model first produces a concise English visual prompt from the current snapshot and chosen image type.
- A server-only OpenAI client calls `gpt-image-2` with `OPENAI_API_KEY`.
- Return the generated image payload through an authenticated, no-store response; do not log prompts containing secrets or persist image bytes.
- The UI renders the image and downloads the compressed WebP returned by OpenAI. The same operation is registered as an optional agent tool with explicit user initiation.

### Report export

- A dedicated report screen renders the latest grounded report and charts.
- CSV is generated deterministically from report metrics/evidence with a UTF-8 BOM for Hebrew spreadsheet compatibility.
- PDF export uses the browser's print stylesheet and native Save as PDF flow so Hebrew shaping and charts match the visible report.

## Implementation phases

### Phase 1 — foundation and data correctness

1. Centralize environment validation and support the repository's documented canonical names.
2. Refactor Sheet loading/filter parsing into a shared authenticated server service.
3. Expand aggregation to every required KPI and chart with explicit formulas documented in README.
4. Add regression tests for filters, top performers, ROI/cost-per-deal, comparison windows, schema failures, duplicates, blank numerics, and source bounds.

Review gate: `bun run check`, `bun test`, `bun run build`; inspect DTOs for secrets and verify no worksheet persistence.

### Phase 2 — dashboard and settings UX

1. Build accessible desktop/mobile filter controls and URL state synchronization.
2. Render all required KPI cards and charts, source/last-sync metadata, row/warning status, manual refresh, clear-all, empty/error/loading states.
3. Improve settings validation and map sanitized error codes to actionable Hebrew messages.
4. Verify keyboard use, RTL, desktop, and 390 px mobile layouts.

Review gate: unit/SSR checks plus Chrome UI verification of settings, refresh, filters, charts, and failure recovery.

### Phase 3 — AI insights and report

1. Add shared analytics snapshot/evidence modules.
2. Add authenticated insights generation API and React screen with explicit progress/retry states.
3. Add grounded management report generation, dedicated report view, CSV download, and print/PDF action.
4. Test schema validation, provider failures, grounding/evidence, and filter propagation.

Review gate: mocked automated tests plus live Chrome UI execution using OpenRouter.

### Phase 4 — question agent and image tool

1. Add a multi-turn question UI and authenticated agent API using the Vercel AI SDK tool loop.
2. Implement read-only analytics tools for KPIs, rankings, comparisons, trends, and evidence.
3. Add AI prompt drafting and authenticated OpenAI image generation with display/download.
4. Register image generation as an agent tool while requiring an explicit image request.

Review gate: live Chrome conversations, follow-up turns, evidence visibility, invalid/unsupported questions, image generation, and download.

### Phase 5 — deployment and acceptance

1. Expand `.env.example` and README without secret values.
2. Reconcile local legacy env names into canonical app variables without exposing values.
3. Use Vercel CLI to set development and preview environment values, verify `vercel pull --environment=development` and `--environment=preview`, and add production values only at deployment handoff as requested.
4. Apply/verify the committed Prisma contract against the intended Neon database.
5. Run `bun run check`, `bun test`, `bun run build`, `bun run test:e2e`, and `bun run db:verify` where credentials permit.
6. Through Chrome DevTools only—no curl or injected JavaScript—verify every PDF function on desktop and 390 px mobile, then repeat critical flows on the public Vercel URL.

## Browser acceptance checklist

- Unauthenticated dashboard/API navigation reaches the Hebrew sign-in flow; sign-up/sign-in succeeds; refresh remains authenticated; sign-out revokes access.
- A user can test, save, revisit, and disconnect a Sheet connection without seeing the API key; another user cannot see it.
- Dashboard shows all ten required KPIs, at least four required charts, source period, last sync, and loading/empty/error states.
- Each of the six filters changes every KPI/chart consistently; multiple filters combine; clear-all restores the full default period.
- Manual sync shows progress and reflects a changed/new Sheet row without duplicate results.
- “נתח את הנתונים” creates fresh, Hebrew, data-grounded insights with three central insights, trends, anomalies, exceptional performers, recommendations, and evidence.
- Free questions and follow-ups return grounded Hebrew answers and visible source metrics; out-of-scope questions are declined without invented data.
- Report contains the selected period, KPIs, summary, AI insights, anomalies, recommendations, and charts; CSV downloads; print/PDF layout is usable.
- Image generation shows progress, uses current data, renders a real `gpt-image-2` result, and downloads the generated image; provider failure is actionable.
- All screens work after reload, with keyboard navigation, no secret leakage, no uncaught console errors, and no horizontal overflow at 390 px.
- The public deployment remains functional and Vercel development/preview env pulls reconstruct the expected local variable set.

## Explicit external handoffs

- If Clerk presents an interactive authentication challenge that cannot be completed with configured test credentials, pause only the affected browser step and ask the user to authenticate in the open browser.
- Production secret values and demo-account credentials are not committed. They are supplied through Vercel/Clerk at deployment handoff.
- The requested short screen-recording deliverable requires a recording destination/tool decision after the final live acceptance pass; application completion does not justify claiming the recording exists until an artifact is produced.
