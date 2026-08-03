# Reliable Streamed AI Generation

## Global Constraints

- Keep DeepSeek V4 Flash and the existing full evidence-grounded insights and management-report schemas.
- Keep existing throughput provider routing and strict JSON Schema output.
- Use one shared `INSIGHTS_MAX_TOKENS = 8_192` for insights and reports.
- Preserve every existing POST request body. Only clients sending `Accept: application/x-ndjson` receive a stream; other callers retain the current JSON DTO.
- Never send partial JSON, model reasoning, prompts, evidence, Sheet data, API keys, or user identity to the browser or logs.
- NDJSON events are only `progress` (`loading-data`, `generating`, `validating`, or `retrying`), `result` (the existing DTO), and `error` (the existing sanitized symbolic code).
- Pass cancellation through browser fetch, Astro `Request.signal`, and the OpenRouter SDK.
- Do not retry `AI_TRUNCATED_RESPONSE`; retain one retry for malformed JSON or schema output.
- Preserve RTL, Hebrew, accessibility, reduced-motion behavior, 390px usability, and report session-storage persistence.
- Add behavior-first tests and verify each new test fails for the missing feature before implementation.
- Preserve the unrelated `.gitignore` change and avoid unrelated refactors.

## Task 1: Stream and validate OpenRouter structured output

Extend the OpenRouter adapter and its tests.

- Add the shared `INSIGHTS_MAX_TOKENS = 8_192` and use it for both insight and report generation.
- Send `stream: true`, keep strict schema routing and current throughput provider sorting, and disable SDK retries as today.
- Consume async provider chunks, concatenate only `delta.content` across arbitrary chunk boundaries, ignore reasoning fields, capture finish reason and final usage metadata, and validate the completed JSON using the existing validators.
- Accept an `AbortSignal` and progress callback without exposing model content. Emit generating pulses for provider content chunks.
- Classify a `length` finish as `AI_TRUNCATED_RESPONSE` before parsing; never retry it. Retain exactly one retry for malformed JSON/schema output and report the `retrying` stage.
- Preserve sanitized provider error mapping.
- Log one sanitized diagnostic record per attempt containing only route, model, provider metadata when available, attempt, finish reason, prompt/completion/reasoning token counts, and duration.
- Tests must cover valid split JSON, arbitrary content boundaries, ignored reasoning, usage capture, cancellation, provider failure, length truncation, schema-failure retry, request `maxTokens: 8192`, `stream: true`, strict schema routing, and throughput sorting.

## Task 2: Add negotiated NDJSON API streaming

Add a shared NDJSON event contract/encoder and update both authenticated generation routes and tests.

- Existing JSON callers keep their current response bodies and error behavior.
- `Accept: application/x-ndjson` returns safe NDJSON event lines in this success order: `loading-data`, `generating` (including repeated provider pulses), `validating`, then `result`.
- A structural retry adds `retrying` before the next `generating` stage.
- A streamed failure ends with one `error` event containing only the existing sanitized symbolic error code.
- Encode complete lines robustly, use an abort-aware stream, cancel provider work when the browser disconnects, and never enqueue after cancellation.
- Preserve existing POST request bodies, Clerk-derived identity, analytics loading, evidence validation, response DTOs, status handling where applicable, and the separation between insights and management reports.
- Tests must cover NDJSON encoding/parsing, successful and failing event order, JSON fallback compatibility, retry stage propagation, and cancellation forwarding.

## Task 3: Add real progress and loading skeletons to both AI screens

Update the AI Insights and management-report React experiences, shared client stream parser as useful, styles, and component/E2E tests.

- Send `Accept: application/x-ndjson`, parse events incrementally across arbitrary byte boundaries, ignore unknown forward-compatible events, and render only the final result DTO.
- Abort in-flight generation on unmount/navigation and before a repeated request.
- First-load Insights replaces the welcome card immediately with a summary-and-insight-card skeleton. First-load Report shows a cover, KPI grid, charts, and AI-section skeleton.
- Drive visible Hebrew stage text from server events exactly:
  - `טוען ומסכם את הנתונים…`
  - `DeepSeek מנתח את הביצועים…`
  - `מאמת את התובנות מול הנתונים…`
  - `מחדד את התוצאה…`
- Provider chunk pulses remain indeterminate and never display token text or a percentage.
- Regeneration retains the current result and overlays/displays a progress banner instead of blanking it.
- Streamed failure removes first-load skeletons, restores action buttons, and displays the existing mapped Hebrew error.
- Apply `aria-busy`, `role="status"`, polite live announcements, RTL layout, reduced-motion support, and a single-column no-overflow layout at 390px.
- Preserve report session-storage persistence and final export behavior.
- Add component tests for first-load skeletons, stage transitions, result, regeneration banner, errors, cancellation, and report persistence. Add Playwright coverage for both screens on desktop and 390px mobile, checking accessibility progress state and overflow.

