import type { Timings } from './timing';

export const json = (data: unknown, status = 200, timings?: Timings) => new Response(
  JSON.stringify(data),
  {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(timings?.header() ? { 'server-timing': timings.header() as string } : {}),
    },
  },
);

export const errorCode = (error: unknown) => (
  typeof error === 'object'
  && error
  && 'code' in error
  && typeof error.code === 'string'
  && /^[A-Z][A-Z0-9_]+$/.test(error.code)
    ? error.code
    : 'UPSTREAM_ERROR'
);

export function assertJson(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw Object.assign(new Error('INVALID_ORIGIN'), {
      code: 'INVALID_ORIGIN',
    });
  }
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw Object.assign(new Error('INVALID_CONTENT_TYPE'), {
      code: 'INVALID_CONTENT_TYPE',
    });
  }
}
