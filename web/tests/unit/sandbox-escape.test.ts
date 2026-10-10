// What a session on a section can't do, tried in the sandbox it runs in (bridge/lib/sandbox.mjs): write outside the
// section, read the bridge's token or the home folder (keys, a browser's profile, another repo), write outside the repo
// but to temp and its agent's own folders, or swap a folder for one of its own so that something which runs later,
// outside the sandbox, reads its files instead (an agent's settings, git's settings, the repo itself).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = path.join(__dirname, '../../../bridge/lib');

/** What is planted in the home folder's private files: no command's output may hold it. */
const MARKER = 'loa-marker-4c1d8e02ab';
/** Private files in a home folder, each holding the marker. */
const PRIVATE = [
  '.ssh/id_ed25519',
  'Library/Application Support/Google/Chrome/Default/Cookies',
  'code/other/.git/config',
];

/**
 * Runs each command in the sandbox of a session on src/ (or, with no scope, on the whole repository), in a fresh
 * repo; true where the command succeeded.
 */
function attempt(commands: Record<string, string>, scope = ['src/']) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-escape-')));
  const home = path.join(base, 'home'),
    repo = path.join(base, 'code', 'repo');
  for (const d of [path.join(home, '.claude'), path.join(home, '.config/git'), path.join(repo, 'src')])
    fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}');
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n');
  fs.writeFileSync(path.join(home, '.zshrc'), '# mine\n');
  for (const f of PRIVATE) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), `${MARKER}\n`);
  }
  fs.writeFileSync(path.join(repo, 'src/a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'o\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'out/\n');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  const url = (f: string) => JSON.stringify(pathToFileURL(path.join(LIB, f)).href);
  const script = `
    const r = await import(${url('repo.mjs')}); r.openRepo();
    const sb = await import(${url('sandbox.mjs')});
    const run = { id: 1, scope: ${JSON.stringify(scope)}, agent: 'claude' };
    await sb.prepareSandbox(run, '/usr/bin/true');
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
        encoding: 'utf8',
      });
      // Whatever it managed, nothing private came out.
      expect(res.stdout + res.stderr, name).not.toContain(MARKER);
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

  it("can't read the home folder: keys, a browser's profile, another repo, or what is in it", () => {
    expect(
      attempt({
        key: 'cat "$HOME/.ssh/id_ed25519"',
        browser: 'cat "$HOME/Library/Application Support/Google/Chrome/Default/Cookies"',
        otherRepo: 'cat "$HOME/code/other/.git/config"',
        list: 'ls "$HOME"',
        find: 'grep -r loa-marker "$HOME"',
        copy: 'cp "$HOME/.ssh/id_ed25519" src/key',
      }),
    ).toEqual({ key: false, browser: false, otherRepo: false, list: false, find: false, copy: false });
  });

  it("reads the repo, git's settings and its own agent's folder", () => {
    expect(
      attempt({ repo: 'cat other.txt', git: 'cat "$HOME/.gitconfig"', agent: 'cat "$HOME/.claude/settings.json"' }),
    ).toEqual({ repo: true, git: true, agent: true });
  });

  it("writes outside the repo only to temp and its agent's own folders", () => {
    expect(
      attempt({
        notes: 'touch "$HOME/notes"',
        shell: 'echo x >> "$HOME/.zshrc"',
        otherRepo: 'touch "$HOME/code/other/x"',
        agent: 'mkdir -p "$HOME/.claude/projects/x"',
        temp: 'touch "${TMPDIR:-/tmp}/loa-escape-probe" /tmp/loa-escape-probe',
        nowhere: 'echo x > /dev/null',
      }),
    ).toEqual({ notes: false, shell: false, otherRepo: false, agent: true, temp: true, nowhere: true });
  });
});

describe.runIf(process.platform === 'darwin')('a session on the whole repository, in its sandbox', () => {
  const whole = (commands: Record<string, string>) => attempt(commands, []);

  it('writes anywhere in the repo, and commits', () => {
    expect(
      whole({
        file: 'echo x >> other.txt && echo y > new.txt',
        commit:
          'git -c user.name=t -c user.email=t@example.test commit -qam "by the agent" && git log --oneline | grep -q agent',
      }),
    ).toEqual({ file: true, commit: true });
  });

  it("never writes git's settings or hooks, the bridge's folder, or agents' settings in the repo", () => {
    expect(
      whole({
        config: 'git config core.fsmonitor "touch /tmp/x"',
        configFile: 'echo "[core]" >> .git/config',
        hook: 'mkdir -p .git/hooks && echo "#!/bin/sh" > .git/hooks/pre-commit',
        bridge: 'echo x > .loa/planted',
        agent: 'mkdir -p .claude && echo "{}" > .claude/settings.json',
      }),
    ).toEqual({ config: false, configFile: false, hook: false, bridge: false, agent: false });
  });

  it("can't read the home folder, write outside the repo, or move the repo away", () => {
    expect(
      whole({
        key: 'cat "$HOME/.ssh/id_ed25519"',
        otherRepo: 'cat "$HOME/code/other/.git/config"',
        notes: 'touch "$HOME/notes"',
        shell: 'echo x >> "$HOME/.zshrc"',
        move: 'mv "$BASE/code/repo" "$BASE/code/repo-away"',
        token: 'cat .loa/bridge.json',
      }),
    ).toEqual({ key: false, otherRepo: false, notes: false, shell: false, move: false, token: false });
  });
});
