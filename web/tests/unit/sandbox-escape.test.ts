// What a session can't do, tried in the sandbox that holds it (bridge/lib/sandbox.mjs). A Claude Code session's
// commands are run as they really run: handed to its hook, which rewrites them to start inside the sandbox
// (bridge/lib/hook.mjs hold), and its file tools are put to the same hook. Tried: writing outside the section,
// reading the bridge's token or the home folder (keys, the keychains, a browser's profile, another repo), writing
// outside the repo but to temp, breaking out of the rewritten command line, and swapping a folder for one of its
// own so that something which runs later, outside the sandbox, reads its files instead.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tagged } from '../support/leftovers';

const LIB = path.join(__dirname, '../../../bridge/lib');

/** What is planted in the home folder's private files: no command's output may hold it. */
const MARKER = 'loa-marker-4c1d8e02ab';
/** Private files in a home folder, each holding the marker. */
const PRIVATE = [
  '.ssh/id_ed25519',
  'Library/Application Support/Google/Chrome/Default/Cookies',
  'code/other/.git/config',
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
  for (const f of [...PRIVATE, 'Library/Keychains/login.keychain-db', 'Library/Keychains/other.keychain-db']) {
    fs.mkdirSync(path.dirname(path.join(home, f)), { recursive: true });
    fs.writeFileSync(path.join(home, f), `${MARKER}\n`);
  }
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
  execFileSync('git', ['update-ref', 'refs/loa/runs/1/before', snapshot], { cwd: repo });
  const url = (f: string) => JSON.stringify(pathToFileURL(path.join(LIB, f)).href);
  const script = `
    const r = await import(${url('repo.mjs')}); r.openRepo();
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
  fs.writeFileSync(path.join(repo, '.loa/bridge.log'), 'Open http://127.0.0.1:43210/#t=SECRET\n');
  fs.writeFileSync(path.join(repo, '.loa/scope-1.json'), JSON.stringify({ scope, ranges: {} }));
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
      LOA_HOLD_DIR: path.join(s.repo, '.loa/hold-1'),
      LOA_SCOPE_FILE: path.join(s.repo, '.loa/scope-1.json'),
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
        // Whatever it managed, nothing private came out.
        expect(res.stdout + res.stderr, name).not.toContain(MARKER);
        return [name, res.status === 0];
      }),
    );
    o.after?.(s);
    return done;
  });
}

/** Whether the hook lets each file tool call through, for a session on `scope`. `~` and `@` stand for home and repo. */
function tools(calls: Record<string, [tool: string, input: Record<string, string>]>, scope = ['src/']) {
  return withSession({ scope }, s =>
    Object.fromEntries(
      Object.entries(calls).map(([name, [tool, input]]) => {
        const at = (v: string) => v.replace(/^~/, s.home).replace(/^@/, s.repo);
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

  it("reads the repo and git's settings, and none of Claude Code's own folder", () => {
    expect(
      attempt({ repo: 'cat other.txt', git: 'cat "$HOME/.gitconfig"', agent: 'cat "$HOME/.claude/settings.json"' }),
    ).toEqual({ repo: true, git: true, agent: false });
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
  it('read this repository, and nothing else', () => {
    expect(
      tools({
        inside: ['Read', { file_path: '@/other.txt' }],
        key: ['Read', { file_path: '~/.ssh/id_ed25519' }],
        keychain: ['Read', { file_path: '~/Library/Keychains/login.keychain-db' }],
        ownFolder: ['Read', { file_path: '~/.claude/settings.json' }],
        token: ['Read', { file_path: '@/.loa/bridge.json' }],
        log: ['Read', { file_path: '@/.loa/bridge.log' }],
        system: ['Read', { file_path: '/etc/hosts' }],
        upAndOut: ['Read', { file_path: '@/src/../../../home/.ssh/id_ed25519' }],
        search: ['Grep', { pattern: 'x' }],
        searchHome: ['Grep', { pattern: 'loa-marker', path: '~' }],
        list: ['Glob', { pattern: '**/*.txt' }],
        listHome: ['Glob', { pattern: '~/.ssh/*' }],
        listAbove: ['Glob', { pattern: '../../home/**' }],
      }),
    ).toEqual({
      inside: true,
      key: false,
      keychain: false,
      ownFolder: false,
      token: false,
      log: false,
      system: false,
      upAndOut: false,
      search: true,
      searchHome: false,
      list: true,
      listHome: false,
      listAbove: false,
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

  it("on the whole repository, write any file but git's own, the bridge's and what runs later", () => {
    expect(
      tools(
        {
          file: ['Write', { file_path: '@/other.txt', content: 'x' }],
          hook: ['Write', { file_path: '@/.git/hooks/pre-commit', content: '#!/bin/sh' }],
          config: ['Edit', { file_path: '@/.git/config', old_string: 'a', new_string: 'b' }],
          bridge: ['Write', { file_path: '@/.loa/planted', content: 'x' }],
          settings: ['Write', { file_path: '@/.claude/settings.json', content: '{}' }],
          home: ['Write', { file_path: '~/notes', content: 'x' }],
        },
        [],
      ),
    ).toEqual({ file: true, hook: false, config: false, bridge: false, settings: false, home: false });
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
    ).toEqual([2, 2]);
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
    ).toEqual([2, 2, 2, 2, 2]);
  });

  it('are the only tools that reach a file or start a program: any other is refused', () => {
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
        fs.rmSync(path.join(s.repo, '.loa/hold-1/hold.json'));
        return ['Bash', 'Read', 'Write', 'TodoWrite'].map(
          tool => hooked(s, tool, { command: 'true', file_path: path.join(s.repo, 'src/a.txt') }).status,
        );
      }),
    ).toEqual([2, 2, 2, 2]);
  });
});

describe.runIf(process.platform === 'darwin')('a Hermes session, whole inside the sandbox', () => {
  const hermes = (commands: Record<string, string>) => attempt(commands, { agent: 'hermes' });

  it('reads and writes its own folder, and writes nowhere else outside the repo but temp', () => {
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
        temp: `touch ${PROBE} && rm ${PROBE}`,
      }),
    ).toEqual({
      inside: true,
      outside: false,
      read: true,
      write: true,
      claude: false,
      notes: false,
      key: false,
      keychain: false,
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

  // Only where git keeps each ref as a file of its own. packed-refs, where git gc moves them, stays writable (a
  // session deletes a packed branch through it), so refs packed there are not held; nor are git's objects (below).
  it("can't change, delete, add or move away the snapshots' refs kept as files", () => {
    expect(
      whole({
        update: 'git update-ref refs/loa/runs/1/before "$(git write-tree | xargs git commit-tree -m x)"',
        remove: 'git update-ref -d refs/loa/runs/1/before',
        file: 'echo 0000000000000000000000000000000000000000 > .git/refs/loa/runs/1/before',
        unlink: 'rm .git/refs/loa/runs/1/before',
        add: 'git update-ref refs/loa/runs/9/before "$(git rev-parse refs/loa/runs/1/before)"',
        move: 'mv .git/refs/loa .git/refs/gone',
        branch: 'git update-ref refs/heads/other "$(git rev-parse refs/loa/runs/1/before)"',
      }),
    ).toEqual({ update: false, remove: false, file: false, unlink: false, add: false, move: false, branch: true });
  });

  // It writes git's folder so its agent can commit, and git keeps snapshots' contents there with everything else.
  it("can still rewrite history, and delete git's objects, the snapshots' among them", () => {
    const sole = (cmd: string) => whole({ done: cmd }).done;
    expect({
      history: sole(
        'git -c user.name=t -c user.email=t@example.test commit -qm one && git update-ref -d HEAD && ! git log -1',
      ),
      objects: sole('rm -rf .git/objects/?? && ! git cat-file -e refs/loa/runs/1/before'),
      packed: sole('echo "# changed" >> .git/packed-refs'),
    }).toEqual({ history: true, objects: true, packed: true });
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
