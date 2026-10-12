/** The port the built app is served on for the tests. LOA_TEST_PORT sets another, to test two checkouts at once. */
export const PORT = Number(process.env.LOA_TEST_PORT) || 4173;

/**
 * The built app, served as static files by tests/support/static-server.mjs; or the site at LOA_APP_URL, for the
 * smoke test on the hosted site once it serves a promoted commit (npm run smoke:live).
 */
export const APP = process.env.LOA_APP_URL ?? `http://127.0.0.1:${PORT}`;

/** The one toast on screen. ui/toast.ts shows every message under the same sonner id. */
export const TOAST = '[data-sonner-toast] [data-title]';
