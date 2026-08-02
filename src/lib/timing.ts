export type Mark = { name: string; duration: number };

export type Timings = {
  /** Times `work` and records it as a `Server-Timing` phase. */
  measure: <T>(name: string, work: () => Promise<T>) => Promise<T>;
  /** `Server-Timing` header value, or `null` when nothing was measured. */
  header: () => string | null;
};

/**
 * Attributes API latency to named phases so a slow response can be traced to the
 * stage that caused it (database, upstream fetch, aggregation) from the browser's
 * network panel, without adding a profiler to the serverless runtime.
 */
export function createTimings(): Timings {
  let marks: readonly Mark[] = [];

  return {
    async measure(name, work) {
      const started = performance.now();
      try {
        return await work();
      } finally {
        marks = [...marks, { name, duration: performance.now() - started }];
      }
    },
    header() {
      if (marks.length === 0) return null;
      return marks
        .map(({ name, duration }) => `${name};dur=${duration.toFixed(1)}`)
        .join(', ');
    },
  };
}

/** No-op collector for callers that do not report timings. */
export const noTimings: Timings = {
  measure: (_name, work) => work(),
  header: () => null,
};
