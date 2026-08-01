import type { APIRoute } from 'astro';
import { loadDashboardForUser } from '../../lib/analytics';
import { errorCode, json } from '../../lib/http';

export const GET: APIRoute = async ({ locals, url }) => {
  const { userId } = locals.auth();
  if (!userId) return json({ error: 'UNAUTHORIZED' }, 401);

  try {
    const bypass = url.searchParams.get('refresh') === '1';
    const { sheet, dashboard } = await loadDashboardForUser(
      userId,
      url.searchParams,
      bypass,
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
    });
  } catch (error) {
    const code = (error as Error).name === 'AbortError'
      ? 'TIMEOUT'
      : errorCode(error);
    return json(
      { error: code },
      code === 'NOT_CONNECTED' ? 409 : 502,
    );
  }
};
