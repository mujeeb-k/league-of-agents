// What a session on a section can't do, tried in the sandbox it runs in (bridge/lib/sandbox.mjs): write outside the
// section, read the bridge's token, or swap a folder for one of its own so that something which runs later, outside
// the sandbox, reads its files instead (an agent's settings, git's settings, the repo itself).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = path.join(__dirname, '../../../bridge/lib');

/** Runs each command in the sandbox of a session on src/, in a fresh repo; true where the command succeeded. */
function attempt(commands: Record<string, string>) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-escape-')));
  const home = path.join(base, 'home'),
    repo = path.join(base, 'code', 'repo');
  for (const d of [path.join(home, '.claude'), path.join(home, '.config/git'), path.join(repo, 'src')])
    fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}');
  fs.writeFileSync(path.join(repo, 'src/a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'o\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'out/\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const url = (f: string) => JSON.stringify(pathToFileURL(path.join(LIB, f)).href);
  const script = `
    const r = await import(${url('repo.mjs')}); r.openRepo();
    const sb = await import(${url('sandbox.mjs')});
    const run = { id: 1, scope: ['src/'], agent: 'claude' };
    await sb.prepareSandbox(run);
    process.stdout.write(JSON.stringify(sb.sandboxArgs(run)));`;
  const args = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repo,
      env: { ...process.env, HOME: home, HERMES_HOME: '', XDG_CONFIG_HOME: '', GIT_CONFIG_GLOBAL: '' },
      encoding: 'utf8',
    }),
  ) as string[];
  fs.writeFileSync(path.join(repo, '.loa/bridge.log'), 'Open http://127.0.0.1:43210/#t=SECRET\n');
  const done = Object.fromEntries(
    Object.entries(commands).map(([name, cmd]) => {
      const res = spawnSync(args[0]!, [...args.slice(1), '/bin/bash', '-c', cmd], {
        cwd: repo,
        env: { ...process.env, HOME: home, BASE: base },
      });
      return [name, res.status === 0];
    }),
  );
  fs.rmSync(base, { recursive: true, force: true });
  return done;
}

describe.runIf(process.platform === 'darwin')('a session on a section, in its sandbox', () => {
  it('writes inside its section, and nowhere else in the repo', () => {
    expect(attempt({ inside: 'echo x >> src/a.txt', outside: 'echo x >> other.txt' })).toEqual({
      inside: true,
      outside: false,
    });
  });

  it("can't read the bridge's token, in its settings or its log", () => {
    expect(attempt({ settings: 'cat .loa/bridge.json', log: 'cat .loa/bridge.log' })).toEqual({
      settings: false,
      log: false,
    });
  });

  it("can't swap a folder that holds what runs later for one of its own", () => {
    expect(
      attempt({
        claude: 'mv "$HOME/.claude" "$HOME/.claude-away"',
        config: 'mv "$HOME/.config" "$HOME/.config-away"',
        home: 'mv "$HOME" "$HOME-away"',
        repoParent: 'mv "$BASE/code" "$BASE/code-away"',
      }),
    ).toEqual({ claude: false, config: false, home: false, repoParent: false });
  });

  it('makes and removes a folder the repo ignores, but no file of that name', () => {
    expect(
      attempt({ folder: 'mkdir out && touch out/a && rm -rf out', deep: 'mkdir -p src/out/x', file: 'touch out' }),
    ).toEqual({ folder: true, deep: true, file: false });
  });

  it('still writes inside those folders, as agents do', () => {
    expect(attempt({ claude: 'mkdir -p "$HOME/.claude/projects/x"', home: 'touch "$HOME/notes"' })).toEqual({
      claude: true,
      home: true,
    });
  });
});
