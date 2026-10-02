// Saves the repository's GitHub traffic, its stars and forks, and the package's npm downloads into a folder:
// the private metrics repository's checkout. GitHub keeps traffic for 14 days only, so this runs daily and
// keeps every day. Views and clones are per day, and a later fetch replaces an earlier one (today's numbers are
// partial). Referrers and popular paths are 14-day totals, kept as a dated snapshot each day.
// It prints no numbers: on a public repository, the Actions log is public.
// Usage: TRAFFIC_TOKEN=… REPO=owner/name NPM_PACKAGE=name node archive.mjs <folder>
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2];
const { TRAFFIC_TOKEN, REPO, NPM_PACKAGE } = process.env;
if (!OUT || !TRAFFIC_TOKEN || !REPO || !NPM_PACKAGE) {
  console.error('Usage: TRAFFIC_TOKEN=… REPO=owner/name NPM_PACKAGE=name node archive.mjs <folder>');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);

async function get(url, headers = {}) {
  const r = await fetch(url, { headers: { 'user-agent': 'loa-metrics', ...headers } });
  if (!r.ok) throw Object.assign(new Error(`${r.status} from ${new URL(url).pathname}`), { status: r.status });
  return r.json();
}
const github = p =>
  get(`https://api.github.com/repos/${REPO}${p}`, {
    authorization: `Bearer ${TRAFFIC_TOKEN}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  });
const file = p => path.join(OUT, p);
const read = (p, d) => {
  try {
    return JSON.parse(fs.readFileSync(file(p), 'utf8'));
  } catch {
    return d;
  }
};
const write = (p, v) => {
  fs.mkdirSync(path.dirname(file(p)), { recursive: true });
  fs.writeFileSync(file(p), JSON.stringify(v, null, 2) + '\n');
};
/** Merges days into a file keyed by date, newer values replacing older ones, in date order. */
const mergeDays = (p, days) => {
  const all = { ...read(p, {}), ...days };
  write(p, Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b))));
};
const byDay = (list, value) => Object.fromEntries(list.map(d => [d.timestamp.slice(0, 10), value(d)]));

const views = await github('/traffic/views?per=day');
mergeDays(
  'github/views.json',
  byDay(views.views, d => ({ count: d.count, uniques: d.uniques })),
);
const clones = await github('/traffic/clones?per=day');
mergeDays(
  'github/clones.json',
  byDay(clones.clones, d => ({ count: d.count, uniques: d.uniques })),
);
write(`github/referrers/${today}.json`, await github('/traffic/popular/referrers'));
write(`github/paths/${today}.json`, await github('/traffic/popular/paths'));
const repo = await github('');
mergeDays('github/repo.json', {
  [today]: { stars: repo.stargazers_count, forks: repo.forks_count, watchers: repo.subscribers_count },
});

// npm counts a day once it is over; the last 30 days, merged, fill in any day a run missed. A package npm's
// download counts don't know yet (it takes a day or two after the first publish) answers 404.
let npm = null;
try {
  npm = await get(`https://api.npmjs.org/downloads/range/last-month/${NPM_PACKAGE}`);
} catch (e) {
  if (e.status !== 404) throw e;
}
if (npm) mergeDays('npm/downloads.json', Object.fromEntries(npm.downloads.map(d => [d.day, d.downloads])));

console.log(
  `Saved traffic, stars and forks${npm ? ', and npm downloads,' : ' (npm has no download counts yet)'} for ${today}.`,
);
