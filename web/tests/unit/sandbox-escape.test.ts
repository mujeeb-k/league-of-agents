// What a session on a section can't do, tried in the sandbox that holds it (bridge/lib/sandbox.mjs). A Claude Code
// session's commands are run as they really run: handed to its hook, which rewrites them to start inside the sandbox
// (bridge/lib/hook.mjs hold), and its file tools are put to the same hook. The section is all it is held to (owner,
// 2026-10-18): it reads what it would anywhere, but for the bridge's token, the Keychain's files and the browsers'
// profiles, which hold the app's login. Tried: writing outside the section, reading the token, the Keychain or a
// browser's profile, writing outside the repo but to temp, breaking out of the
// rewritten command line, and swapping a folder for one of its own so that something which runs later, outside the
// sandbox, reads its files instead.
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tagged } from '../support/leftovers';

const LIB = path.join(__dirname, '../../../bridge/lib');

/** What is planted in the Keychain's files and the browsers' profiles: no command's output may hold it. */
const MARKER = 'loa-marker-4c1d8e02ab';
/** Files in a home folder a session may read, as anywhere. */
const PRIVATE = ['.ssh/id_ed25519', 'code/other/.git/config'];
/**
 * Where each browser keeps what it holds of a person's logins, League of Agents' own among them: no session reads
 * these. Each holds the marker.
 */
const BROWSERS = [
  'Library/Application Support/Google/Chrome/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/Google/Chrome/Profile 1/Cookies',
  'Library/Application Support/Google/Chrome Canary/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/Chromium/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/Microsoft Edge/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/BraveSoftware/Brave-Browser/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/Arc/User Data/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/Vivaldi/Default/Local Storage/leveldb/000003.log',
  'Library/Application Support/com.operasoftware.Opera/Local Storage/leveldb/000003.log',
  'Library/Application Support/Firefox/Profiles/abc.default-release/webappsstore.sqlite',
  'Library/Safari/LocalStorage/http_127.0.0.1_43210.localstorage',
  'Library/Containers/com.apple.Safari/Data/Library/WebKit/WebsiteData/LocalStorage/x.sqlite3',
  'Library/WebKit/WebsiteData/LocalStorage/x.sqlite3',
  'Library/Cookies/Cookies.binarycookies',
];

type Session = { base: string; home: string; repo: string };
type Opts = {
  /** The session's selection; none for the whole repository. */
  scope?: string[];
  /** Hermes runs whole inside the sandbox; Claude Code's commands reach it through its hook. */
  agent?: 'claude' | 'hermes';
  /** The repo's .gitignore; `out/` when none is given. */
  gitignore?: string;
  /** Looks at what is left, before it is cleared away. */
  after?: (s: Session) => void;
};
const BRIDGE = path.join(LIB, '../loa.mjs');
/** League of Agents' folder for a repo, in a home folder (bridge/lib/util.mjs loaOf). */
const loaOf = (home: string, root: string) =>
  path.join(
    home,
    '.config/league-of-agents/repos',
    crypto.createHash('sha256').update(root).digest('hex').slice(0, 32),
  );
/** A file in /tmp, which every session may write: named after this run, written and removed by the command itself. */
const PROBE = tagged('escape-probe');

/** A fresh home folder and repo, with a session on `scope` prepared in it, handed to `use`. */
function withSession<T>(
  { scope = ['src/'], agent = 'claude', gitignore = 'out/\n' }: Opts,
  use: (s: Session, args: string[] | null) => T,
): T {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loa-escape-')));
  const home = path.join(base, 'home'),
    repo = path.join(base, 'code', 'repo');
  for (const d of ['.claude', '.hermes', '.config/git', 'Library/Keychains'])
    fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude/settings.json'), '{}');
  fs.writeFileSync(path.join(home, '.hermes/state.json'), '{}');
  fs.writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = t\n');
  fs.writeFileSync(path.join(home, '.zshrc'), '# mine\n');
  for (const f of PRIVATE) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), 'readable\n');
  }
  for (const f of ['Library/Keychains/login.keychain-db', 'Library/Keychains/other.keychain-db', ...BROWSERS]) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), `${MARKER}\n`);
  }
  // Another repo's bridge, running: its key, which would let a session drive that bridge, and its log of links, in
  // League of Agents' folder for that repo, and where a bridge before this one kept them, in the repo.
  for (const dir of [loaOf(home, path.join(home, 'code/other')), path.join(home, 'code/other/.loa')]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ port: 1, token: MARKER }));
    fs.writeFileSync(path.join(dir, 'bridge.log'), `Open http://127.0.0.1:1/#t=${MARKER}\n`);
  }
  fs.mkdirSync(path.join(home, '.config/league-of-agents/running'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.config/league-of-agents/running/1'),
    JSON.stringify({ root: path.join(home, 'code/other'), hooks: false }),
  );
  fs.writeFileSync(path.join(repo, 'src/a.txt'), 'a\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'o\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), gitignore);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['add', '-A'], { cwd: repo });
  // A snapshot, as the bridge pins one before a run.
  const tree = execFileSync('git', ['write-tree'], { cwd: repo, encoding: 'utf8' }).trim();
  const person = { NAME: 't', EMAIL: 't@example.test' };
  const snapshot = execFileSync('git', ['commit-tree', tree, '-m', 'before'], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...Object.fromEntries(
        ['AUTHOR', 'COMMITTER'].flatMap(w => Object.entries(person).map(([k, v]) => [`GIT_${w}_${k}`, v])),
      ),
    },
  }).trim();
  const url = (f: string) => JSON.stringify(pathToFileURL(path.join(LIB, f)).href);
  const script = `
    const r = await import(${url('repo.mjs')}); r.openRepo();
    await r.keep('refs/loa/runs/1/before', ${JSON.stringify(snapshot)});
    const sb = await import(${url('sandbox.mjs')});
    sb.setClaudeHeld(true);
    const run = { id: 1, scope: ${JSON.stringify(scope)}, agent: ${JSON.stringify(agent)} };
    await sb.prepareSandbox(run, '/usr/bin/true');
    process.stdout.write(JSON.stringify(sb.holdsAgent(run) ? sb.sandboxArgs(run) : null));`;
  const args = JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repo,
      env: { ...process.env, HOME: home, HERMES_HOME: '', XDG_CONFIG_HOME: '', GIT_CONFIG_GLOBAL: '' },
      encoding: 'utf8',
    }),
  ) as string[] | null;
  fs.writeFileSync(path.join(loaOf(home, repo), 'bridge.log'), 'Open http://127.0.0.1:43210/#t=SECRET\n');
  fs.writeFileSync(path.join(loaOf(home, repo), 'scope-1.json'), JSON.stringify({ scope, ranges: {} }));
  try {
    return use({ base, home, repo }, args);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

/** A tool call handed to the hook that holds a Claude Code session, as Claude Code hands it one. */
function hooked(s: Session, tool: string, input: object, id = 't1') {
  return spawnSync(process.execPath, [BRIDGE, 'hook', 'hold'], {
    cwd: s.repo,
    input: JSON.stringify({ tool_name: tool, tool_input: input, tool_use_id: id, cwd: s.repo }),
    env: {
      ...process.env,
      HOME: s.home,
      LOA_HOLD_DIR: path.join(loaOf(s.home, s.repo), 'hold-1'),
      LOA_SCOPE_FILE: path.join(loaOf(s.home, s.repo), 'scope-1.json'),
    },
    encoding: 'utf8',
  });
}

/**
 * Runs each command as a session's shell command runs: for Claude Code, rewritten by its hook and then run by a
 * shell outside the sandbox, as Claude Code runs what the hook hands back; for Hermes, inside the sandbox it starts
 * in. True where the command succeeded. No command's output may hold what the home folder's private files hold.
 */
function attempt(commands: Record<string, string>, opts: Opts | string[] = {}) {
  const o = Array.isArray(opts) ? { scope: opts } : opts;
  return withSession(o, (s, args) => {
    const env = { ...process.env, HOME: s.home, BASE: s.base };
    const done = Object.fromEntries(
      Object.entries(commands).map(([name, cmd], i) => {
        let res;
        if (args)
          res = spawnSync(args[0]!, [...args.slice(1), '/bin/bash', '-c', cmd], { cwd: s.repo, env, encoding: 'utf8' });
        else {
          const hook = hooked(s, 'Bash', { command: cmd }, `t${i}`);
          expect(hook.status, hook.stderr).toBe(0);
          const { command } = (JSON.parse(hook.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } })
            .hookSpecificOutput.updatedInput;
          res = spawnSync('/bin/zsh', ['-c', command], { cwd: s.repo, env, encoding: 'utf8' });
        }
        // Whatever it managed, nothing of the Keychain's came out.
        expect(res.stdout + res.stderr, name).not.toContain(MARKER);
        return [name, res.status === 0];
      }),
    );
    o.after?.(s);
    return done;
  });
}

/**
 * Whether the hook lets each file tool call through, for a session on `scope`. `~`, `@` and `%` stand for home, repo
 * and League of Agents' folder for the repo.
 */
function tools(calls: Record<string, [tool: string, input: Record<string, string>]>, scope = ['src/']) {
  return withSession({ scope }, s =>
    Object.fromEntries(
      Object.entries(calls).map(([name, [tool, input]]) => {
        const at = (v: string) => v.replace(/^~/, s.home).replace(/^@/, s.repo).replace(/^%/, loaOf(s.home, s.repo));
        const res = hooked(s, tool, Object.fromEntries(Object.entries(input).map(([k, v]) => [k, at(v)])));
        expect(res.stdout + res.stderr, name).not.toContain(MARKER);
        return [name, res.status === 0];
      }),
    ),
  );
}

describe.runIf(process.platform === 'darwin')('a session on a section, in its sandbox', () => {
  it('writes inside its section, and nowhere else in the repo', () => {
    expect(attempt({ inside: 'echo x >> src/a.txt', outside: 'echo x >> other.txt' })).toEqual({
      inside: true,
      outside: false,
    });
  });

  it("can't read a bridge's token, in its settings or its log, its own or another repo's", () => {
    expect(
      attempt({
        settings: 'cat "$HOME"/.config/league-of-agents/repos/*/bridge.json',
        log: 'cat "$HOME"/.config/league-of-agents/repos/*/bridge.log',
        records: 'ls "$HOME"/.config/league-of-agents/repos/*/runs',
        earlier: 'cat "$HOME/code/other/.loa/bridge.json"',
        earlierLog: 'cat "$HOME/code/other/.LOA/Bridge.log"',
        search: 'grep -r loa-marker "$HOME/code" "$HOME/.config"',
      }),
    ).toEqual({ settings: false, log: false, records: false, earlier: false, earlierLog: false, search: false });
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

  it("installs into the project's own ignored folders, whatever the ignore file's rules look like", () => {
    // A rule with `!` keeps the bridge from reading the rest as patterns: git is asked about these folders directly.
    expect(
      attempt(
        {
          venv: 'mkdir .venv && mkdir -p .venv/bin && touch .venv/bin/python && rm -rf .venv && mkdir .venv',
          packages: 'mkdir -p node_modules/left-pad && touch node_modules/left-pad/index.js',
          notIgnored: 'mkdir venv',
          asFile: 'rmdir .venv && touch .venv',
          other: 'mkdir build',
        },
        { gitignore: '.venv\nnode_modules/\nbuild/\n!build/keep/\n' },
      ),
    ).toEqual({ venv: true, packages: true, notIgnored: false, asFile: false, other: false });
  });

  it("reads the home folder as it would anywhere, but for the Keychain and the browsers' profiles", () => {
    expect(
      attempt({
        key: 'cat "$HOME/.ssh/id_ed25519"',
        otherRepo: 'cat "$HOME/code/other/.git/config"',
        list: 'ls "$HOME"',
        copy: 'cp "$HOME/.ssh/id_ed25519" src/key',
        keychain: 'grep -r loa-marker "$HOME/Library/Keychains"',
      }),
    ).toEqual({ key: true, otherRepo: true, list: true, copy: true, keychain: false });
  });

  it("can't read any browser's profile, where the app's login is kept", () => {
    const each = Object.fromEntries(BROWSERS.map(f => [f, `cat "$HOME/${f}"`]));
    expect(
      attempt({
        ...each,
        copy: `cp "$HOME/${BROWSERS[0]}" src/copy`,
        search: 'grep -r loa-marker "$HOME/Library"',
        list: 'ls "$HOME/Library/Application Support/Google/Chrome/Default"',
      }),
    ).toEqual({
      ...Object.fromEntries(BROWSERS.map(f => [f, false])),
      copy: false,
      search: false,
      list: false,
    });
  });

  it("reads the repo, git's settings and Claude Code's own folder", () => {
    expect(
      attempt({ repo: 'cat other.txt', git: 'cat "$HOME/.gitconfig"', agent: 'cat "$HOME/.claude/settings.json"' }),
    ).toEqual({ repo: true, git: true, agent: true });
  });

  it('writes outside the repo only to temp', () => {
    expect(
      attempt({
        notes: 'touch "$HOME/notes"',
        shell: 'echo x >> "$HOME/.zshrc"',
        otherRepo: 'touch "$HOME/code/other/x"',
        agent: 'mkdir -p "$HOME/.claude/projects/x"',
        temp: `touch "$TMPDIR/escape-probe" ${PROBE} && rm "$TMPDIR/escape-probe" ${PROBE}`,
        nowhere: 'echo x > /dev/null',
      }),
    ).toEqual({ notes: false, shell: false, otherRepo: false, agent: false, temp: true, nowhere: true });
  });

  it('runs no setuid program, ps among them: nothing a session starts runs outside the sandbox', () => {
    expect(
      attempt({ ps: '/bin/ps -o pid= -p $$', top: '/usr/bin/top -l 1 -n 0', sudo: '/usr/bin/sudo -n true' }),
    ).toEqual({
      ps: false,
      top: false,
      sudo: false,
    });
  });

  it("the hook's answer arrives whole, however long it is", () => {
    // The answer is the command to run, with the sandbox's rules in it: 10 kB for one folder. Written and then cut
    // off by the hook's own exit, it arrived short wherever a pipe took less at once than it held: at 8,192 bytes
    // on GitHub's Mac. Here a selection of 300 files with long names makes it longer than a pipe holds on this one.
    const scope = Array.from({ length: 300 }, (_, i) => `src/${'a-long-folder-name-'.repeat(8)}${i}/file.ts`);
    withSession({ scope }, s => {
      const hook = hooked(s, 'Bash', { command: 'echo hello' });
      expect(hook.status, hook.stderr).toBe(0);
      expect(hook.stdout.length).toBeGreaterThan(70_000);
      const answer = JSON.parse(hook.stdout) as { hookSpecificOutput: { updatedInput: { command: string } } };
      expect(answer.hookSpecificOutput.updatedInput.command).toMatch(/commands\/t1\.sh'$/);
    });
  });

  it('whatever its quotes, new lines and substitutions, a command runs inside and changes nothing outside', () => {
    // Each would write outside the section if any part of it were read by the shell that starts the sandbox.
    const out = 'echo x >> other.txt; touch "$HOME/escaped"';
    const tried = attempt(
      {
        plain: `echo 'it'"'"'s' "a $(echo b)" > src/q.txt && grep -q "it's a b" src/q.txt`,
        closingQuote: `'; ${out}; echo '`,
        closingDouble: `"; ${out}; echo "`,
        substitution: `echo "$(${out})"`,
        backticks: 'echo `' + out + '`',
        lines: `echo a\n${out}\necho b`,
        heredoc: `cat <<'EOF' > src/h.txt\n'; ${out}\nEOF\n${out}`,
        escapes: `\\'; ${out}; \\'`,
        nul: `printf '%s' "'" | xargs -I{} sh -c "${out}"`,
        unicode: `echo ’‘＂ && ${out}`,
      },
      {
        after: s => {
          expect(fs.readFileSync(path.join(s.repo, 'other.txt'), 'utf8')).toBe('o\n');
          expect(fs.existsSync(path.join(s.home, 'escaped'))).toBe(false);
        },
      },
    );
    expect(tried.plain).toBe(true);
  });
});

describe.runIf(process.platform === 'darwin')("a Claude Code session's file tools, held by its hook", () => {
  it("read anything but the bridge's token and the Keychain", () => {
    expect(
      tools({
        inside: ['Read', { file_path: '@/other.txt' }],
        key: ['Read', { file_path: '~/.ssh/id_ed25519' }],
        keychain: ['Read', { file_path: '~/Library/Keychains/login.keychain-db' }],
        ownFolder: ['Read', { file_path: '~/.claude/settings.json' }],
        token: ['Read', { file_path: '%/bridge.json' }],
        log: ['Read', { file_path: '%/bridge.log' }],
        system: ['Read', { file_path: '/etc/hosts' }],
        upAndOut: ['Read', { file_path: '@/src/../../../home/.ssh/id_ed25519' }],
        search: ['Grep', { pattern: 'x' }],
        searchHome: ['Grep', { pattern: 'loa-marker', path: '~' }],
        list: ['Glob', { pattern: '**/*.txt' }],
        listHome: ['Glob', { pattern: '~/.ssh/*' }],
        listAbove: ['Glob', { pattern: '../../home/**' }],
        ...Object.fromEntries(
          BROWSERS.map(f => [f, ['Read', { file_path: `~/${f}` }] as [string, Record<string, string>]]),
        ),
        searchBrowser: ['Grep', { pattern: 'loa-marker', path: '~/Library/Application Support/Google' }],
        searchLibrary: ['Grep', { pattern: 'loa-marker', path: '~/Library' }],
        listBrowser: ['Glob', { pattern: '*', path: '~/Library/Safari' }],
        apps: ['Read', { file_path: '~/Library/Application Support/Code/User/settings.json' }],
      }),
    ).toEqual({
      inside: true,
      key: true,
      keychain: false,
      ownFolder: true,
      token: false,
      log: false,
      system: true,
      upAndOut: true,
      search: true,
      // The home folder holds the Keychain: a search of it would read the Keychain's files.
      searchHome: false,
      list: true,
      listHome: true,
      listAbove: false,
      ...Object.fromEntries(BROWSERS.map(f => [f, false])),
      searchBrowser: false,
      searchLibrary: false,
      listBrowser: false,
      // Other apps' settings are read as anywhere.
      apps: true,
    });
  });

  it('write the selection, and nothing else', () => {
    expect(
      tools({
        inside: ['Write', { file_path: '@/src/new.txt', content: 'x' }],
        edit: ['Edit', { file_path: '@/src/a.txt', old_string: 'a', new_string: 'b' }],
        outside: ['Write', { file_path: '@/other.txt', content: 'x' }],
        home: ['Write', { file_path: '~/notes', content: 'x' }],
        shellSetup: ['Edit', { file_path: '~/.zshrc', old_string: 'mine', new_string: 'theirs' }],
        notebook: ['NotebookEdit', { notebook_path: '@/other.ipynb', new_source: 'x' }],
      }),
    ).toEqual({ inside: true, edit: true, outside: false, home: false, shellSetup: false, notebook: false });
  });

  it('follow a link in the selection to where it leads', () => {
    expect(
      withSession({}, s => {
        fs.symlinkSync(path.join(s.home, '.zshrc'), path.join(s.repo, 'src/link'));
        return [
          hooked(s, 'Write', { file_path: path.join(s.repo, 'src/link'), content: 'x' }).status,
          hooked(s, 'Read', { file_path: path.join(s.repo, 'src/link') }).status,
        ];
      }),
    ).toEqual([2, 0]);
  });

  it('follow a linked folder too, for a file not there yet', () => {
    expect(
      withSession({}, s => {
        // Made by a command inside the section, as the sandbox allows; then used by a file tool outside it.
        fs.symlinkSync(s.home, path.join(s.repo, 'src/d'));
        return [
          hooked(s, 'Write', { file_path: path.join(s.repo, 'src/d/notes'), content: 'x' }).status,
          hooked(s, 'Write', { file_path: path.join(s.repo, 'src/d/new/deep/notes'), content: 'x' }).status,
          hooked(s, 'Read', { file_path: path.join(s.repo, 'src/d/.ssh/id_ed25519') }).status,
          hooked(s, 'Grep', { pattern: 'loa-marker', path: path.join(s.repo, 'src/d') }).status,
          hooked(s, 'Glob', { pattern: 'src/d/**' }).status,
        ];
      }),
    ).toEqual([2, 2, 0, 2, 2]);
  });

  // Another repo's bridge key would let a session start a run there, held by nothing: no tool reads it, nor searches a
  // folder that holds it.
  it("never read another bridge's key or its log, nor search a folder that holds them", () => {
    expect(
      tools({
        key: ['Read', { file_path: '~/.config/league-of-agents/repos/x/bridge.json' }],
        earlier: ['Read', { file_path: '~/code/other/.loa/bridge.json' }],
        log: ['Read', { file_path: '~/code/other/.LOA/bridge.log' }],
        home: ['Grep', { path: '~', pattern: 't' }],
        code: ['Grep', { path: '~/code', pattern: 't' }],
        config: ['Grep', { path: '~/.config', pattern: 't' }],
        records: ['Glob', { path: '~/.config', pattern: '**/*.json' }],
        own: ['Grep', { path: '@/src', pattern: 'a' }],
        names: ['Glob', { path: '~/code', pattern: '**/*.json' }],
      }),
    ).toEqual({
      key: false,
      earlier: false,
      log: false,
      home: false,
      code: false,
      config: false,
      records: false,
      own: true,
      names: true,
    });
  });

  // A tool that could reach a file or start a program runs in Claude Code's own process, outside the sandbox: on a
  // section it would write anywhere (git's hooks, another repo), so it is refused, and said. Tools that touch no file
  // run.
  it("let only tools that touch no file run: an MCP server's, Monitor and a tool not known are refused", () => {
    expect(
      tools({
        plan: ['TodoWrite', {}],
        web: ['WebFetch', { url: 'https://example.test' }],
        subagent: ['Agent', { prompt: 'x' }],
        added: ['mcp__files__write_file', { path: '~/notes' }],
        watcher: ['Monitor', { command: 'touch ~/notes' }],
        unknown: ['SomethingNew', {}],
      }),
    ).toEqual({ plan: true, web: true, subagent: true, added: false, watcher: false, unknown: false });
  });

  it("refuse every call when the session's hold can't be read", () => {
    expect(
      withSession({}, s => {
        fs.rmSync(path.join(loaOf(s.home, s.repo), 'hold-1/hold.json'));
        return ['Bash', 'Read', 'Write', 'TodoWrite'].map(
          tool => hooked(s, tool, { command: 'true', file_path: path.join(s.repo, 'src/a.txt') }).status,
        );
      }),
    ).toEqual([2, 2, 2, 2]);
  });
});

describe.runIf(process.platform === 'darwin')('a Hermes session, whole inside the sandbox', () => {
  const hermes = (commands: Record<string, string>) => attempt(commands, { agent: 'hermes' });

  it("reads what it would anywhere but the Keychain and the browsers' profiles, writes its own folder, and nowhere else outside the repo but temp", () => {
    expect(
      hermes({
        inside: 'echo x >> src/a.txt',
        outside: 'echo x >> other.txt',
        read: 'cat "$HOME/.hermes/state.json"',
        write: 'mkdir -p "$HOME/.hermes/sessions/x"',
        claude: 'cat "$HOME/.claude/settings.json"',
        notes: 'touch "$HOME/notes"',
        key: 'cat "$HOME/.ssh/id_ed25519"',
        keychain: 'cat "$HOME/Library/Keychains/login.keychain-db"',
        browser: `cat "$HOME/${BROWSERS[0]}"`,
        browsers: 'grep -r loa-marker "$HOME/Library"',
        bridge: 'cat "$HOME"/.config/league-of-agents/repos/*/bridge.json',
        earlier: 'cat "$HOME/code/other/.loa/bridge.json"',
        temp: `touch ${PROBE} && rm ${PROBE}`,
      }),
    ).toEqual({
      inside: true,
      outside: false,
      read: true,
      write: true,
      claude: true,
      notes: false,
      key: true,
      keychain: false,
      browser: false,
      browsers: false,
      bridge: false,
      earlier: false,
      temp: true,
    });
  });
});

describe.runIf(process.platform === 'darwin')('the keychain folder, in a session', () => {
  const K = '"$HOME/Library/Keychains"';

  it("can't be read, listed or copied", () => {
    expect(
      attempt({
        list: `ls ${K}`,
        read: `cat ${K}/login.keychain-db`,
        copy: `cp ${K}/login.keychain-db src/k`,
      }),
    ).toEqual({ list: false, read: false, copy: false });
  });

  it("can't be written: no file changed, deleted, moved or added, nor the folder moved", () => {
    expect(
      attempt({
        save: `echo x >> ${K}/login.keychain-db`,
        remove: `rm ${K}/login.keychain-db`,
        move: `mv ${K}/login.keychain-db src/k`,
        temp: `echo x > ${K}/login.keychain-db.sb-1a2b3c-XyZ`,
        add: `touch ${K}/new.keychain-db`,
        folder: `mv ${K} "$HOME/Library/Keychains-away"`,
      }),
    ).toEqual({ save: false, remove: false, move: false, temp: false, add: false, folder: false });
  });
});
