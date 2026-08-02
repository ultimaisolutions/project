/// <reference types="astro/client-image" />

interface ImportMetaEnv {
	readonly PUBLIC_VERCEL_ANALYTICS_ID: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

interface Window {
	/**
	 * In-flight `GET /api/dashboard` started by the inline kickoff script in
	 * `src/pages/dashboard.astro`, so the request does not wait for hydration.
	 * The `Dashboard` island consumes it exactly once, then deletes it.
	 */
	__dashboardPrefetch?: Promise<Response>;
}
