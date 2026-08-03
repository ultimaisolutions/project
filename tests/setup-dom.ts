import { JSDOM } from 'jsdom';

/**
 * Minimal browser environment for hook/component tests under `bun test`.
 * Import this module *before* any DOM-dependent import so its side effects
 * run first — ESM evaluates sibling imports in source order.
 *
 * These globals are installed process-wide and never torn down. `bun test`
 * shares one process across files, so any test asserting SSR safety without
 * browser globals — currently `dashboard-ssr.test.tsx` — must run before the
 * first importer of this module. Bun orders files by path, and
 * `dashboard-ssr` sorts before `polling-refresh`. Renaming either file, or
 * importing this from an earlier-sorting one, would quietly void that
 * assertion.
 */
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:4321/' });
const globals = globalThis as unknown as Record<string, unknown>;

globals['window'] = dom.window;
globals['document'] = dom.window.document;
globals['navigator'] = dom.window.navigator;
globals['location'] = dom.window.location;
globals['sessionStorage'] = dom.window.sessionStorage;
globals['HTMLElement'] = dom.window.HTMLElement;
globals['Event'] = dom.window.Event;
globals['IS_REACT_ACT_ENVIRONMENT'] = true;

/** Overrides `document.hidden`, which jsdom exposes as a read-only getter. */
export function setDocumentHidden(hidden: boolean): void {
  Object.defineProperty(dom.window.document, 'hidden', { value: hidden, configurable: true });
}

/** Fires the visibility change event listeners registered by the hook. */
export function dispatchVisibilityChange(): void {
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
}
