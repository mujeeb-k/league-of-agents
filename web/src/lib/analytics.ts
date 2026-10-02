// Page views on leagueofagents.dev, through Vercel Web Analytics (what is collected is on the privacy
// page). Never in the app a bridge serves on this computer, and never the address's query or fragment, where a
// connect link carries its token.
import type { BeforeSendEvent } from '@vercel/analytics';

export const SITE = 'leagueofagents.dev';

/** An event's address without its query or fragment. */
export function scrub(e: BeforeSendEvent): BeforeSendEvent {
  const u = new URL(e.url);
  return { ...e, url: u.origin + u.pathname };
}

/** Starts page views on the site only; call it once the connect token is out of the address bar. */
export function startAnalytics() {
  if (location.hostname !== SITE) return;
  void import('@vercel/analytics').then(({ inject }) => inject({ mode: 'production', beforeSend: scrub }));
}
