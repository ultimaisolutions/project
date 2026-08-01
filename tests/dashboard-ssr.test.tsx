import { expect, test } from 'bun:test';
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/components/dashboard/Dashboard';

test('dashboard can render on the server without browser globals', () => {
  expect(() => renderToString(<Dashboard />)).not.toThrow();
});
