// Chrome-family browsers ask once before a web site may reach apps on this computer, the bridge included
// ("local network access"). The page says what is coming before the browser asks, and says so when it was refused.
import type { Conn } from './types';

export type Access = 'granted' | 'prompt' | 'denied';

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

/**
 * Whether this page may reach the bridge. Only a page on the web reaching a bridge on this computer is asked
 * about; a browser that has no such permission (Safari, Firefox) counts as allowed and connects as before.
 * Chrome asks for loopback-network; earlier versions called it local-network-access.
 */
export async function localAccess(c: Conn): Promise<Access> {
  if (LOOPBACK.test(location.origin) || !LOOPBACK.test(c.base)) return 'granted';
  for (const name of ['loopback-network', 'local-network-access'])
    try {
      return (await navigator.permissions.query({ name: name as PermissionName })).state;
    } catch {
      /* not a permission this browser knows */
    }
  return 'granted';
}
