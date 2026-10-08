// Where the bridge's own files are: the package's bridge/ folder, or the copy in .loa/ that the hooks run.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson } from './util.mjs';

/** The folder holding loa.mjs and lib/. */
export const BRIDGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The command that runs the bridge. */
export const ENTRY = path.join(BRIDGE_DIR, 'loa.mjs');
/** This bridge's version, reported to the app, which asks for an update when it is too old. */
export const VERSION = readJson(path.join(BRIDGE_DIR, '..', 'package.json'), {}).version ?? null;
// Web app: the built web/dist folder. LOA_WEB_FILE still serves a single HTML file instead.
export const WEB_DIR = process.env.LOA_WEB_DIR || path.join(BRIDGE_DIR, '..', 'web', 'dist');
export const WEB_FILE = process.env.LOA_WEB_FILE || '';
