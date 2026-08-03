# CoreWeave Structured Insights Routing Design

## Problem

The same DeepSeek V4 Flash workload behaved differently across OpenRouter providers:

- CoreWeave: streamed, 6,071 native prompt tokens, 1,171 native completion tokens, `finish_reason: stop`, about 23.5 seconds.
- Parasail: streamed, 6,071 native prompt tokens, 20,000 native completion tokens, `finish_reason: length`, about 406.9 seconds.

The Parasail completion ignored the strict response schema, used invalid evidence placeholders, added Markdown fences, and repeated complete JSON objects until the token ceiling. Git evidence shows the prompt and schema did not change; provider sorting changed from latency to throughput before the regression.

## Decision

Use an explicit provider allowlist for grounded insights and management-report generation, with CoreWeave as the verified primary:

- Keep `deepseek/deepseek-v4-flash`.
- Keep `stream: true` and the existing private chunk accumulator.
- Keep strict JSON Schema output and `requireParameters: true`.
- Set `provider.order` to `['CoreWeave', 'DeepInfra', 'StreamLake', 'Baidu']`.
- Set `provider.allowFallbacks` to `false`.
- Remove throughput sorting from these structured requests.
- Set the shared insights/report completion budget to `4_096` tokens.
- Enforce a 120-second deadline across the complete provider stream, not only request establishment.

CoreWeave failure or unavailability may advance only through DeepInfra, StreamLake, and Baidu in that order. Exhausting the allowlist must fail closed with the existing sanitized error behavior; the request must never silently route to a provider outside the list.

## Cancellation and Errors

The complete-stream deadline and the caller's cancellation signal are combined. Navigation, unmount, or a repeated request continues to cancel provider work without showing an error. An internal deadline failure is sanitized through the existing upstream-error path.

`finish_reason: length` remains `AI_TRUNCATED_RESPONSE` and is not retried. Missing or abnormal terminal reasons remain sanitized non-retryable failures. The existing single retry remains limited to malformed JSON, schema output, or empty structured output.

No prompts, evidence, Sheet data, provider messages, or user identity are added to logs or browser events.

## Verification

Tests must be written first and prove:

- Both insight and report requests send `maxTokens: 4_096`.
- Structured requests emit the exact approved provider order, disable routing outside that list, retain `requireParameters: true`, and contain no throughput sort.
- A provider stream that remains open beyond the 120-second deadline is aborted even after it has started producing chunks.
- Caller cancellation, strict finish handling, schema validation, retry policy, NDJSON progress, and JSON fallback continue to work.

Run `bun run check`, `bun test`, `bun run test:e2e`, and `bun run build` before the localhost smoke test.

The localhost smoke test is accepted only when the OpenRouter generation record shows:

- provider `CoreWeave`;
- `streamed: true`;
- `finish_reason: stop`;
- native completion below 4,096 tokens;
- no repeated JSON or Markdown fences;
- the final Insights UI renders the validated result.

## Scope Boundary

This change does not modify the prompt, evidence catalog, output schema, report construction, NDJSON event contract, loading UI, or deployment configuration. CoreWeave is production-shaped smoke-tested; fallback activation remains observable through the existing sanitized provider diagnostics and OpenRouter generation records.
