# CoreWeave Structured Insights Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make grounded insights and management reports reliably complete by prioritizing verified CoreWeave with an explicit three-provider fallback order, capping output at 4,096 tokens, and enforcing a 120-second deadline across the complete provider stream.

**Architecture:** Keep the existing strict-schema streamed adapter and client progress transport. Change only the shared structured-request routing/budget and compose the caller signal with an internal deadline signal inside `generateStructuredObject`, mapping internal deadline expiry to the existing sanitized upstream error.

**Tech Stack:** TypeScript, OpenRouter SDK 1.2.4, Bun 1.3, Zod 4, Astro 6.

## Global Constraints

- Keep `deepseek/deepseek-v4-flash`, `stream: true`, strict JSON Schema, and `requireParameters: true`.
- Both insights and reports use one shared `INSIGHTS_MAX_TOKENS = 4_096`.
- Route through CoreWeave, DeepInfra, StreamLake, and Baidu in that order; disable routing outside the list and do not retain throughput sorting.
- Preserve caller cancellation and add a 120-second total-stream deadline.
- Keep request bodies, DTOs, prompt, evidence/schema validation, retry rules, NDJSON events, UI, persistence, and exports unchanged.
- Never log or return prompts, evidence, Sheet data, provider messages, credentials, or user identity.
- Preserve the unrelated `.gitignore` modification and temporary plan artifacts.

---

### Task 1: Pin and bound structured generation

**Files:**
- Modify: `src/lib/ai/openrouter.ts`
- Test: `tests/openrouter.test.ts`

**Interfaces:**
- Consumes: `generateStructuredObject(options, dependencies)` and `buildStructuredChatRequest(options)`.
- Produces: the same validated return type and progress/diagnostic callbacks; outbound provider preferences use the approved ordered allowlist and generation uses a composed deadline signal.

- [ ] **Step 1: Write failing routing and budget tests**

Update the high-level insight/report request test to expect `[4_096, 4_096]`. Update the outbound request test to require this exact provider object and the absence of `sort`:

```ts
provider: {
  requireParameters: true,
  order: ['CoreWeave', 'DeepInfra', 'StreamLake', 'Baidu'],
  allowFallbacks: false,
}
```

- [ ] **Step 2: Run routing tests and verify RED**

Run:

```bash
bun test tests/openrouter.test.ts -t 'streams the full structured-output budget|uses the shared token budget'
```

Expected: fail because production still sends 20,000 tokens and `sort: 'throughput'` without the approved provider order.

- [ ] **Step 3: Implement routing and budget**

Set `INSIGHTS_MAX_TOKENS` to `4_096`. Replace throughput sorting in `buildStructuredChatRequest` with `order: ['CoreWeave', 'DeepInfra', 'StreamLake', 'Baidu']` and `allowFallbacks: false`, retaining `requireParameters: true`.

- [ ] **Step 4: Run routing tests and verify GREEN**

Run the Step 2 command. Expected: both tests pass and the request retains `stream: true` plus strict JSON Schema.

- [ ] **Step 5: Write a failing total-stream deadline test**

Extend `StructuredOutputDependencies` with an injectable timeout-signal factory:

```ts
createTimeoutSignal?: (timeoutMs: number) => AbortSignal;
```

The test supplies a controlled `AbortController`, starts a stream that has already emitted a content chunk but remains open, aborts the timeout controller, and asserts:

```ts
expect(receivedTimeoutMs).toBe(120_000);
expect(error).toMatchObject({ code: 'UPSTREAM_ERROR' });
expect(providerSignal?.aborted).toBe(true);
```

- [ ] **Step 6: Run the deadline test and verify RED**

Run:

```bash
bun test tests/openrouter.test.ts -t 'aborts an active provider stream at the total generation deadline'
```

Expected: fail because the current SDK timeout does not compose a deadline signal across stream consumption.

- [ ] **Step 7: Implement the total-stream deadline**

Inside `generateStructuredObject`, create a deadline signal using the injected factory or `AbortSignal.timeout(DEFAULT_TIMEOUT_MS)`. Compose it with `options.signal` using `AbortSignal.any` when a caller signal exists. Pass the composed signal to both SDK request options and `consumeStructuredChatStream`.

In error handling, preserve the caller's abort reason when `options.signal.aborted`. If only the deadline signal aborted, throw `aiError('UPSTREAM_ERROR')`. Preserve all existing finish-reason, schema, provider-error, and retry behavior.

- [ ] **Step 8: Run focused and full verification**

Run:

```bash
bun test tests/openrouter.test.ts
bun run check
bun test
bun run test:e2e
bun run build
```

Expected: focused and full suites pass, Astro reports zero diagnostics, Playwright passes desktop and 390px projects, and the production build exits zero.

- [ ] **Step 9: Commit the focused implementation**

Stage only `src/lib/ai/openrouter.ts` and `tests/openrouter.test.ts`, then commit:

```bash
git commit -m "fix: pin structured AI generation to CoreWeave"
```

- [ ] **Step 10: Run localhost acceptance**

Generate Insights once with the authenticated localhost dataset. Accept only if OpenRouter reports CoreWeave, streaming, `finish_reason: stop`, fewer than 4,096 native completion tokens, no repeated JSON/fences, and the UI renders the validated result.
