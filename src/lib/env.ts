export type ServerEnvName =
  | 'DATABASE_URL'
  | 'DB_STRING'
  | 'SETTINGS_ENCRYPTION_KEY'
  | 'GOOGLE_SHEETS_API'
  | 'SHEET_ID'
  | 'SHEET_NAME'
  | 'OPENROUTER_API_KEY'
  | 'OPENAI_API_KEY'
  | 'PUBLIC_SITE_URL'
  | 'VERCEL_PROJECT_PRODUCTION_URL';

/** Resolves a server setting with Vite taking precedence, trimming blank values away. */
export function resolveServerEnv(
  viteValue: string | undefined,
  processValue: string | undefined,
) {
  return viteValue?.trim() || processValue?.trim() || undefined;
}

function isLocalHostname(hostname: string) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '[::1]';
}

/** Keeps local auth local while pinning hosted auth to the configured site origin. */
export function resolveAuthOrigin(requestUrl: URL, configuredSiteUrl?: string) {
  if (isLocalHostname(requestUrl.hostname)) return requestUrl.origin;

  if (configuredSiteUrl) {
    try {
      const configuredUrl = new URL(configuredSiteUrl);
      if (
        (configuredUrl.protocol === 'https:' || configuredUrl.protocol === 'http:')
        && !isLocalHostname(configuredUrl.hostname)
      ) {
        return configuredUrl.origin;
      }
    } catch {
      // Fall through to the request origin for malformed optional configuration.
    }
  }

  return requestUrl.origin;
}

/** Resolves the canonical hosted site URL, including Vercel's system fallback. */
export function getConfiguredSiteUrl() {
  const siteUrl = getServerEnv('PUBLIC_SITE_URL');
  if (siteUrl) return siteUrl;

  const vercelProjectUrl = getServerEnv('VERCEL_PROJECT_PRODUCTION_URL');
  return vercelProjectUrl ? `https://${vercelProjectUrl}` : undefined;
}

/** Reads an allowed server-only environment variable from Vite or the Node process. */
export function getServerEnv(name: ServerEnvName) {
  switch (name) {
    case 'DATABASE_URL':
      return resolveServerEnv(import.meta.env.DATABASE_URL, process.env.DATABASE_URL);
    case 'DB_STRING':
      return resolveServerEnv(import.meta.env.DB_STRING, process.env.DB_STRING);
    case 'SETTINGS_ENCRYPTION_KEY':
      return resolveServerEnv(import.meta.env.SETTINGS_ENCRYPTION_KEY, process.env.SETTINGS_ENCRYPTION_KEY);
    case 'GOOGLE_SHEETS_API':
      return resolveServerEnv(import.meta.env.GOOGLE_SHEETS_API, process.env.GOOGLE_SHEETS_API);
    case 'SHEET_ID':
      return resolveServerEnv(import.meta.env.SHEET_ID, process.env.SHEET_ID);
    case 'SHEET_NAME':
      return resolveServerEnv(import.meta.env.SHEET_NAME, process.env.SHEET_NAME);
    case 'OPENROUTER_API_KEY':
      return resolveServerEnv(import.meta.env.OPENROUTER_API_KEY, process.env.OPENROUTER_API_KEY);
    case 'OPENAI_API_KEY':
      return resolveServerEnv(import.meta.env.OPENAI_API_KEY, process.env.OPENAI_API_KEY);
    case 'PUBLIC_SITE_URL':
      return resolveServerEnv(import.meta.env.PUBLIC_SITE_URL, process.env.PUBLIC_SITE_URL);
    case 'VERCEL_PROJECT_PRODUCTION_URL':
      return resolveServerEnv(
        import.meta.env.VERCEL_PROJECT_PRODUCTION_URL,
        process.env.VERCEL_PROJECT_PRODUCTION_URL,
      );
  }
}
