// The command line, as the bridge reads it (node:util parseArgs). Flags it doesn't know are left alone, as before.
import { parseArgs } from 'node:util';

export const argv = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: argv,
  allowPositionals: true,
  strict: false,
  options: {
    port: { type: 'string' },
    web: { type: 'string' },
    'app-path': { type: 'string' },
    local: { type: 'boolean' },
    hooks: { type: 'boolean' },
    'no-hooks': { type: 'boolean' },
    'no-open': { type: 'boolean' },
  },
});
/** The command and what follows it: `hooks remove`, `start`, `serve`. */
export const [command, subcommand] = positionals;
/** A flag's value or whether it was given. */
export const opt = name => values[name];
const flag = (name, dflt) => (typeof values[name] === 'string' ? values[name] : dflt);
// A port asked for is used as it is (and a busy one says so); otherwise the first free one from 43210, so a
// second repo's bridge doesn't fail because the first holds the usual port.
export const ASKED_PORT = flag('port', process.env.LOA_PORT);
export const SITE = 'https://leagueofagents.dev';
// --local: the local app only, in every browser. The website is never opened or printed, and can't connect.
export const WEB_URL = opt('local') ? '' : flag('web', process.env.LOA_WEB_URL || SITE).replace(/\/$/, '');
// Where the app lives, on the bridge and on the hosted site: "/" today, "/app/" once the site has a homepage.
// The bridge serves it there, and every link it prints or opens points there.
export const APP_PATH = `/${flag('app-path', process.env.LOA_APP_PATH || '/')}/`.replace(/\/+/g, '/');
