import './setup-dom';
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import DataSettings from '../src/components/DataSettings';

const originalFetch = globalThis.fetch;

const baseSettings = {
  apiKeyConfigured: true,
  maskedApiKey: '•••• •••• •••• ••••',
  spreadsheetId: 'system-sheet-id',
  worksheetName: 'נתונים',
  status: 'CONNECTED',
  lastTestedAt: null,
  lastSyncAt: null,
  lastErrorCode: null,
  serverDefaultsAvailable: true,
};

function respondWith(connectionSource: 'environment' | 'user' | 'none') {
  globalThis.fetch = Object.assign(
    async () => new Response(JSON.stringify({
      ...baseSettings,
      connectionSource,
      status: connectionSource === 'none' ? 'DISCONNECTED' : 'CONNECTED',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    { preconnect: originalFetch.preconnect },
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe('data settings source states', () => {
  test('shows an automatic system source without the obsolete quick-connect action', async () => {
    respondWith('environment');
    const view = render(<DataSettings />);

    expect(await view.findByText('מקור מערכת')).not.toBeNull();
    expect(view.queryByText('מקור הנתונים של סביבת ההדגמה מוכן')).toBeNull();
    expect(view.getByRole('button', { name: 'ניתוק' })).not.toBeNull();
    expect(view.queryByRole('button', { name: 'שחזור ברירת מחדל' })).toBeNull();
  });

  test('offers both disconnect and restore-default for a custom override', async () => {
    respondWith('user');
    const view = render(<DataSettings />);

    expect(await view.findByText('חיבור מותאם')).not.toBeNull();
    expect(view.getByRole('button', { name: 'ניתוק' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'שחזור ברירת מחדל' })).not.toBeNull();
  });

  test('keeps restore-default available while explicitly disconnected', async () => {
    respondWith('none');
    const view = render(<DataSettings />);

    expect(await view.findAllByText('מנותק')).toHaveLength(2);
    expect(view.queryByRole('button', { name: 'ניתוק' })).toBeNull();
    expect(view.getByRole('button', { name: 'שחזור ברירת מחדל' })).not.toBeNull();
  });
});
