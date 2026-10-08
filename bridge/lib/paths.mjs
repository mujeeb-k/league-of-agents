// Where the bridge's own files are: the package's bridge/ folder, or the copy in .loa/ that the hooks run.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The folder holding loa.mjs and lib/. */
export const BRIDGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** The command that runs the bridge. */
export const ENTRY = path.join(BRIDGE_DIR, 'loa.mjs');
