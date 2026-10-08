/**
 * The built app, served as static files by tests/support/static-server.mjs; or the site at LOA_APP_URL, for the
 * smoke test on the hosted site once it serves a promoted commit (npm run smoke:live).
 */
export const APP = process.env.LOA_APP_URL ?? 'http://127.0.0.1:4173';

/** The one toast on screen. ui/toast.ts shows every message under the same sonner id. */
export const TOAST = '[data-sonner-toast] [data-title]';
