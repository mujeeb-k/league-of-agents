#!/usr/bin/env node
// Writes THIRD-PARTY-NOTICES.txt: every library the built app can bundle (the web app's production dependencies and
// theirs), each with its license as its own package states it. The bridge has no dependencies.
// `node scripts/third-party-notices.mjs` writes the file; with `--check` it fails if the file is out of date.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'THIRD-PARTY-NOTICES.txt');
const tree = JSON.parse(
  execFileSync('npm', ['ls', '--omit=dev', '--all', '--long', '--json'], {
    cwd: path.join(root, 'web'),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
);

/** Each installed package once, by name and version: where it is. An optional one that isn't installed has no path. */
const found = new Map();
(function walk(deps) {
  for (const [name, d] of Object.entries(deps ?? {})) {
    if (d.path && fs.existsSync(d.path)) found.set(`${name}@${d.version}`, { name, version: d.version, dir: d.path });
    walk(d.dependencies);
  }
})(tree.dependencies);

const licenseFile = dir =>
  fs
    .readdirSync(dir)
    .filter(f => /^(licen[sc]e|copying)(\.|$)/i.test(f))
    .sort()[0];

const parts = [...found.values()]
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map(({ name, version, dir }) => {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const file = licenseFile(dir);
    const text = file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : null;
    const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see the package');
    const home = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? pkg.homepage ?? '');
    return [
      `${name} ${version}`,
      `License: ${license}`,
      ...(home ? [`Source: ${home.replace(/^git\+/, '').replace(/\.git$/, '')}`] : []),
      '',
      text ?? `(This package ships no license file; its package.json states ${license}.)`,
    ].join('\n');
  });

const body =
  [
    'Third-party notices',
    '',
    'League of Agents is licensed under the Apache License 2.0 (see LICENSE and NOTICE). The app it serves (web/dist)',
    'is built from the libraries below, each under its own license, reproduced here as its package states it. The',
    'IBM Plex fonts are licensed separately (web/dist/fonts). The bridge (bridge/) has no dependencies.',
    '',
    `${parts.length} packages.`,
  ].join('\n') +
  '\n\n' +
  parts.map(p => '-'.repeat(80) + '\n' + p).join('\n\n') +
  '\n';

if (process.argv.includes('--check')) {
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== body) {
    console.error('THIRD-PARTY-NOTICES.txt is out of date. Run: node scripts/third-party-notices.mjs');
    process.exit(1);
  }
} else fs.writeFileSync(out, body);
