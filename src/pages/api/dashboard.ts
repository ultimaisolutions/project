import type { APIRoute } from 'astro';
import { loadDashboardForUser } from '../../lib/analytics';
import { errorCode, json } from '../../lib/http';
import { createTimings } from '../../lib/timing';

export const GET: APIRoute = async ({ locals, url }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  // This route sits on the dashboard's critical path; Server-Timing makes the
  // split between database, Google Sheets, and aggregation visible in DevTools.
  const timings = createTimings();

  try {
    const bypass = url.searchParams.get('refresh') === '1';
    const { sheet, dashboard } = await loadDashboardForUser(
      userId,
      url.searchParams,
      bypass,
      timings,
    );

    return json({
      ...dashboard,
      sync: {
        status: 'CONNECTED',
        lastSyncAt: sheet.lastSyncAt?.toISOString() ?? null,
      },
      validRows: dashboard.filteredRows,
      skippedRows: sheet.skippedRows,
      warnings: sheet.warnings,
    }, 200, timings);
  } catch (error) {
    const code = (error as Error).name === 'AbortError'
      ? 'TIMEOUT'
      : errorCode(error);
    return json(
      { error: code },
      code === 'NOT_CONNECTED' ? 409 : 502,
      timings,
    );
  }
};
