<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

[English](README.md) · [简体中文](README.zh-CN.md) · [Français](README.fr.md) · [Português (Brasil)](README.pt-BR.md) · [Español](README.es.md)

## What is League of Agents?

See every change your agents make. League of Agents is a map of your codebase where you direct coding agents and review their work.

Coding agents change more code than anyone can review line by line. League of Agents shows your project as a map, and every change an agent makes lands on it. You see what changed, where, and whether it still works, then keep it or undo it.

It runs on your computer, works with the agents you already use, and is open source.

![Three sessions at work on the map, a fourth started on a folder beside them, then its diff reviewed file by file](docs/media/demo.gif)

## What you can do

- **See your project at once.** Its folders and code files on one map. Zoom out for the shape, zoom in to read the code.
- **Point an agent at exact lines.** Select a file, a folder, or a few lines, and describe the change. Next to the agent's name you see one of two things:
  - **"Stays inside your selection."** On macOS, Claude Code, Hermes and DeepSeek Harness run inside the system's own sandbox: they, and every program they start, can write only inside your selection and to files the repo ignores (build output, installed packages). What the sandbox allows outside the repo is [listed below](#the-sandbox-on-macos).
  - **"Can change files outside your selection. You'll see each one flagged."** Codex and Cursor, and every agent where there's no sandbox (Linux, Windows). With the hooks on, Claude Code's edit tools are still blocked outside your selection, and what its shell commands change outside it is put back.

  When a session tries to change a file outside your selection, the write is blocked and its card asks: "Wants to change <file>". **Allow** adds the file to its selection and the session carries on where it stopped; **Refuse** keeps the file out. If another session is working on that file, the card says which, and Allow waits until that session ends. The hooks are off until you say yes: the first `npx leagueofagents-cli@latest` in a terminal asks once and remembers, and without a terminal they stay off unless you pass `--hooks`. To check, look for `"hooks": true` in `.loa/bridge.json`.
- **Watch the work.** Each session at work has a marker on the file it's reading or editing, on the map and the minimap, and its edits are drawn as they land. Follow a session to have the map move with it. A run's steps are listed in order; click one to see its file as that step left it.
- **Edit files yourself.** Double-click a file's code to open it in the editor. Saved edits are recorded and can be undone like any agent run.
- **Update what depends on a change.** Rename a function, then ask the agent to update every file that uses it. The diff of your change goes into the agent's prompt. The map shows each file it touched.
- **Review before you keep.** Switch between Before, After and Diff, step through changed files, then keep the run or undo it in one click. Once kept, commit just that run's files with a message you write; nothing is pushed.
- **Run your checks automatically.** Tests and type checks run after each run that changes files, so you know if it still works.

## Quick start

Open a terminal in any project folder that is a git repo, then pick one:

**Let your agent set it up.** Paste this into Claude Code, Codex or Cursor:

```text
Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
```

**Or run it yourself:**

```bash
npx leagueofagents-cli@latest
```

What happens next:

1. League of Agents starts in the background and opens your repo as a map in your browser.
2. In Chrome, Edge, Brave and Arc, it opens on leagueofagents.dev. The browser asks once to let the site reach your computer: choose Allow. In Safari and Firefox, it opens the local app, which needs no permission.
3. Select a file, describe a change, and press Enter.

### Requirements

- macOS. Linux passes the full test suite, but hasn't been tried with a real agent yet. Windows isn't supported yet.
- git. On a Mac, this comes with Apple's command line developer tools: `xcode-select --install`. On Linux, from your package manager.
- Node 20 or later
- A git repository
- Claude Code installed and logged in, to run agents from the map. Without it, changes from any editor still show up.

## Works with

Claude Code, from the map or your terminal. Hermes Agent and DeepSeek Harness, from the map, through the Agent Client Protocol (Hermes needs its `acp` extra). Codex and Cursor are in beta. Changes from any other editor or agent show up through watch mode. Each run shows the model its agent reported.

Any other harness that speaks the Agent Client Protocol can be added in your own settings, never a repo's:

```json
[{ "id": "goose", "name": "Goose", "command": ["goose", "acp"] }]
```

Save it as `~/.config/league-of-agents/agents.json` and restart League of Agents. Keys, providers and models stay in each harness's own settings. Hermes asks before it edits, and DeepSeek Harness runs in its read-only mode, so it asks too: an edit outside your selection is refused. An added harness that doesn't ask has those edits flagged after the run.

<sub>Built and tested with Claude Code, Hermes Agent and DeepSeek Harness. Codex and Cursor support follows their published formats and passes tests against them, but hasn't been fully verified with real runs yet.</sub>

## Using it

**From the map.** Select files, folders or lines, pick an agent, describe the change and press Enter. When the run finishes, review it and keep it or undo it. With a finished run selected, your next prompt continues the same session. To start fresh, choose "Start a new session instead" from the "Follow-up" menu.

Selected lines are held by their text and the lines around them, not by their numbers. If edits, a branch switch or a rebase move the code, the selection follows it. If the code changed, was removed, or can't be told apart from an identical copy, the selection says so and nothing runs until you select again. When an agent edits inside your selection, the selection takes the new lines.

Sessions on sections that don't overlap run at the same time; a session on the whole repository runs alone. Edits made during a run are counted in that run, including your own.

**From your terminal.** Use Claude Code, Codex or Cursor as usual. With the hooks on, each prompt you send becomes a run on the map, titled by the prompt.

**From any editor.** Just work. When files you changed go quiet for a few seconds, League of Agents records them as one run, such as "Edited main.py". Files git ignores and new files that usually hold secrets ([listed below](#privacy-and-security)) never make a run and are never in a snapshot, and branch switches and pulls never make a run.

A renamed file keeps its place on the map and shows as renamed, with what changed in it. A folder renamed as a whole keeps its place too.

### Checks

If your repo has none set up, League of Agents looks for test and typecheck scripts and pytest, and offers to turn them on. They're kept in your home folder, outside your repo, unless you choose to share them with your team in `loa.config.json`. Checks a repo commits in its `loa.config.json` are offered with their commands, and run only once you turn them on in your copy; if the list changes, they wait for you again. A check that can't run on your machine, because something it needs isn't installed, shows as "Couldn't run" instead of failing, and can be turned off in one click. See [`loa.config.example.json`](loa.config.example.json) to write your own.

### What it writes on your machine

In your repo:

- `.loa/`: run records, the bridge's port and token, a private snapshot index, a copy of the bridge the hooks run, the map's layout, and a log. It's kept out of git through `.git/info/exclude`, and the bridge won't start in a repo that commits it.
- Snapshots: git commits under private `refs/loa/` refs, stored in `.git/objects`. They never touch your branch or staging area. The bridge never commits or stages on its own. A commit happens only when you click Commit, and only for that session's files.
- `loa.config.json`, only if you choose to share your checks with your team.

In your home folder:

- `~/.config/league-of-agents/repos/`: one file per repo with the checks you turned on or approved there. It's outside the repo, so nothing a repo contains can allow its own commands.

In agent settings, only after you say yes to the hooks:

- Claude Code: `.claude/settings.local.json` in the repo, kept out of git.
- Codex: `.codex/hooks.json` in the repo, kept out of git if League of Agents created it.

A hook file that's in git is never edited: the hooks hold this computer's paths. League of Agents says so when it starts, and that agent's terminal sessions aren't recorded.
- Cursor: `~/.cursor/hooks.json` in your home folder. Cursor reads project hooks only from the folder it opened, which is often above the repo.

Your own hooks in these files are never changed. Your browser also keeps the bridge's port and a session token of its own (each link works once: the page exchanges the link's code for that token), and your panel, theme and language choices, in its own storage.

To remove it:

| What | How |
|---|---|
| Hooks, in all three files | `npx leagueofagents-cli@latest hooks remove`. A file League of Agents created is deleted; a file you had is put back as it was. |
| Everything in the repo: hooks, `refs/loa/`, `.loa/` and its lines in `.git/info/exclude`, and the checks you allowed for it | `npx leagueofagents-cli@latest uninstall` |
| Snapshot objects in `.git/objects` | Unreferenced after `uninstall`. Git prunes them on its own after two weeks, or right away with `git gc --prune=now`. |
| `loa.config.json` | Delete it, if you created it. |
| What your browser keeps | Click Disconnect, or clear the site's data for leagueofagents.dev. |

## What it sends

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.

- **The bridge** talks to 127.0.0.1 only: the app in your browser, and the hooks of your agents. It makes no other network requests. It runs git locally and never fetches or pushes. When it starts, it opens your browser on leagueofagents.dev or on the local app, and it runs `claude auth status` to see whether Claude Code is logged in.
- **leagueofagents.dev** serves static files: the page, its scripts, fonts and images. It talks to the bridge straight from your browser, so your code, prompts and runs go between your browser and your computer only. It counts page views with Vercel Web Analytics: the page's path, without anything after `?` or `#`; the site that linked to it; country, region and city, worked out from the request; and the operating system, browser and kind of device. No cookies. The app the bridge serves on your computer counts nothing. Details are on the [privacy page](https://leagueofagents.dev/privacy).
- **Installing** downloads the package from the npm registry.
- **Your agent** gets your prompt and a list of the selected files or lines, as paths and line numbers. "Update what depends on this" also puts the diff of your change in the prompt. The agent sends what it reads and is given to its own provider, under that provider's terms.
- **Your checks** run the commands you turned on. What they do is up to them.

## How it starts your agent

When you run an agent from the map, the bridge starts it in your repo with these commands. `<prompt>` is your prompt with the scope written above it.

| Agent | Command |
|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits` |
| Cursor | `cursor-agent -p --force --output-format stream-json <prompt>` |
| Codex | `codex exec --json --sandbox workspace-write <prompt>` |

A follow-up adds `--resume <session>` for Claude Code and Cursor, and `resume <session>` for Codex. What each permission flag allows:

- **Claude Code, `--permission-mode acceptEdits`:** it creates and edits files in the repo without asking, and **runs `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` there without asking.** Other shell commands and network requests need a rule you set in Claude Code; with `-p` there is no one to ask, so they're denied. ([permission modes](https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode), [non-interactive runs](https://code.claude.com/docs/en/headless#auto-approve-tools)) This is how a run on the whole repository starts, and every run where there is no sandbox. **Inside the sandbox on macOS, a session on a selection starts with `--permission-mode bypassPermissions` instead:** Claude Code runs any command without asking, and the sandbox is the limit. Its own check refused harmless commands (pipes, loops, its own verification), and inside the sandbox it adds nothing the sandbox doesn't enforce for files.
- **Cursor, `-p --force`:** **it runs shell commands without asking.** `-p` gives it every tool, including write and shell, and `--force` allows commands unless you've explicitly denied them. ([CLI parameters](https://cursor.com/docs/cli/reference/parameters))
- **Codex, `exec --sandbox workspace-write`:** **it runs commands in the repo without asking.** It reads and edits files and runs commands inside the repo. Network access is off, and it can't go beyond the repo. ([non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode), [approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security))

### The sandbox on macOS

A session on a selection, by Claude Code, Hermes or DeepSeek Harness, runs inside macOS's sandbox (`sandbox-exec`). It holds the agent and every program the agent starts.

- **Writes inside the repo:** only your selection and files the repo ignores. A lockfile outside the selection that `npm install` would change is refused too, so select the folder that holds the package.
- **Writes outside the repo:** only temp folders, the agent's own folders (`~/.claude`, `~/.hermes`, `~/.dsh`) and caches (`~/.cache`, `~/Library/Caches`, `~/.npm`). A Claude Code session can also write your login keychain file (`~/Library/Keychains/login.keychain-db`, with its temp and lock files): Claude Code keeps its login there and must save it when the login is renewed, and macOS has no narrower way to save a keychain item.
- **Reads:** nothing in your home folder except the repo, the agent's own folders, those caches, git's settings (`~/.gitconfig`, `~/.config/git`), and the programs it runs: Node, the agent's own install, and the folders on your `PATH`. Your SSH keys, browser profiles and other repos in your home folder can't be read. When a command is refused a path, the session's card names it. A Claude Code session can also read `~/Library/Keychains`, where its login is; macOS guards each keychain item separately.
- **Never written, even inside those:** the bridge's token (`.loa/bridge.json` and its log, which can't be read either), the bridge's own code, your git settings and your repo's git hooks, the bridge's approved checks (`~/.config/league-of-agents`), and the agents' settings and hook files (Claude Code's `settings.json` and `settings.local.json`, Codex's `config.toml` and `hooks.json`, Cursor's `hooks.json`, Hermes's `config.yaml` and `hooks/`). The folders that hold them, and your repo's, can't be moved or replaced.
- **Commands run without asking, network included.** The sandbox limits files, not the network: a session can send what it can read, your repo included, anywhere. Use agents and prompts you trust.
- **Files the repo ignores stay writable,** such as installed packages in `node_modules`. What later runs them, such as your checks, a git hook or a dev server, runs what the session wrote, outside the sandbox.
- **Folders outside your home folder** (other disks, `/opt`, `/usr/local`) can be read as any program of yours can.
- **What a session starts is held; what already runs is not.** A tmux server, Docker, or a dev server that writes files on request can still write for it.
- **If the sandbox can't start** (the bridge is itself running inside one), a session on a selection is refused rather than run without it.
- **A run on the whole repository is not sandboxed.** It has your account's reach, and Claude Code keeps its own permission check there.

### Where there is no sandbox

On Linux and Windows, and for Codex and Cursor everywhere:

- With the hooks on, Claude Code's edit tools are blocked outside your selection before they write.
- The hooks take a snapshot before and after each shell command. What it changed outside your selection is put back as soon as the command ends, kept, and named on the run so you can restore it in one click. **That window is the whole command:** a file you save outside every selection while a 3-minute test runs is put back too.
- Each shell command waits for the two snapshots: about 0.2 s on a repo of 1,200 files, about 5 s on llvm's 186,000. On macOS each waits only for a snapshot of its selection, about 0.2 s on llvm.
- Nothing limits what a session reads.

## Privacy and security

League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized. What it sends, and to where, is [above](#what-it-sends). Who can reach League of Agents on your computer, and how it's protected, is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Report security issues privately, as [SECURITY.md](SECURITY.md) explains.

Snapshots leave out files git ignores, and any file not yet committed with one of these names, in any folder: `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `*.kdbx`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `.npmrc`, `.pypirc`, `.netrc`, `.git-credentials`, `.htpasswd`, `credentials.json`, `secrets.json`, `secrets.yaml`, `secrets.yml`, `service-account*.json`, `*.tfvars`. This list is not complete: a secret with any other name is snapshotted like any file, so keep secrets in files git ignores. A file already committed is in your repo's history, and snapshots include it.

Snapshots stay on your computer unless you send them: `git push`, `git push --all` and `git push --tags` never include `refs/loa/`, but `git push --mirror` sends every ref, `refs/loa/` included, and so does copying the `.git` folder. Run `uninstall` first if you mirror a repo.

## Limits

- macOS. Linux passes the full test suite in CI, but hasn't been tried with a real agent yet; there, it opens the local app. Windows isn't supported yet.
- Remote machines, SSH and dev containers aren't supported. League of Agents must run on the same computer as your browser.
- A map shows up to 5,000 code files, and the first 400 lines of each on its card; a file opens in full, before, after and diff. In a larger repository you pick a folder to map, and can change it at any time. Files over 16 MB aren't on the map.
- Non-code files, such as images, are in snapshots and undo, but not on the map.
- Files git ignores and new files that usually hold secrets are never in a snapshot and never make a run on their own. An agent's own activity is different: what it reads, prints or edits is kept in `.loa/runs/` on your computer, so if an agent opens a secret file, its content can be there. `uninstall` removes it.
- Inside a session, agents run commands without asking, network included, and a session can send the repo's contents out over the network. On macOS the sandbox limits which files a session on a selection reads and writes ([the list](#the-sandbox-on-macos)); it does not limit the network. Runs on the whole repository, and every run on Linux and Windows, are not sandboxed.
- A session on a selection can write files the repo ignores, such as `node_modules` and build output. Your checks, git hooks and dev server may run those files later, outside the sandbox.
- Runs on sections that don't overlap work at the same time; a run on the whole repository works alone.
- Shell commands. Hermes runs them without asking, except ones it judges dangerous, which League of Agents refuses. On macOS, on a section, both Hermes and DeepSeek Harness run inside the section's sandbox, so no command can write outside it; DeepSeek Harness then runs in its full-access mode, since its own sandbox can't start inside another. Elsewhere DeepSeek Harness runs them read-only, so a command that writes is refused. What a command changes inside the section is flagged as not made by the agent's edit tools while other sessions work, since only edit tools name the files they change. Revert undoes it.
- It keeps the newest 500 runs, and every run from the last 30 days. Older runs are deleted, with their snapshots.
- The website needs Chrome, Edge, Brave or Arc. Safari and Firefox use the local app instead.

## Commands and options

| Command | What it does |
|---|---|
| `npx leagueofagents-cli@latest` | Starts League of Agents in the background and opens your browser |
| `... status` | Shows whether it's running, and its link |
| `... stop` | Stops it |
| `... uninstall` | Removes everything it added to the repo |
| `... hooks remove` | Removes only its hooks |

| Option | Default | What it does |
|---|---|---|
| `--port`, `LOA_PORT` | First free port from 43210 | Port League of Agents listens on |
| `--web`, `LOA_WEB_URL` | `https://leagueofagents.dev` | Website to open in Chrome-family browsers |
| `--local` | Off | Use only the local app, in every browser: the website is never opened, and can't connect |
| `--hooks`, `--no-hooks` | Asks once | Add or skip the agent hooks without asking |
| `LOA_CLAUDE_BIN` | `claude` | Claude Code command |
| `LOA_CODEX_BIN` | `codex` | Codex command |
| `LOA_CURSOR_BIN` | `cursor-agent` | Cursor command (newer installs may call it `agent`) |

## For teams

- **Pin a version.** `@latest` fetches the newest release each time. To run the same version everywhere, name it: `npx leagueofagents-cli@0.1.3`. Releases are listed on [npm](https://www.npmjs.com/package/leagueofagents-cli?activeTab=versions) and in this repo's tags.
- **An internal registry.** The package has no dependencies, so a mirror needs only `leagueofagents-cli` itself: `npx --registry https://npm.example.internal leagueofagents-cli@0.1.3`, or set `registry` in your `.npmrc`.
- **No website.** `--local` uses only the app League of Agents serves on 127.0.0.1, in every browser, and lets no website connect. Nothing is fetched from leagueofagents.dev.
- **Checks in a shared repo.** Checks committed in `loa.config.json` run on a computer only after the person there approves that exact list, and again after any change to it. Approvals are kept in each person's home folder, never in the repo.
- **Hook files in git.** A hook file that's in git is never edited, so that agent's terminal sessions aren't recorded.
- **What stays on each computer.** Runs and snapshots are kept per repo, per computer: the newest 500 runs and every run from the last 30 days. Snapshots leave out files git ignores and untracked files that usually hold secrets ([list](#privacy-and-security)). `git push --mirror` would send them; plain pushes never do.

## How it works

League of Agents has two parts:

- **The bridge** (`bridge/loa.mjs`) runs on your computer, inside your repo. Node 20 or later, no dependencies. Before and after each run, it snapshots your files into a git commit using a private index, so your branch and staging area are never touched. Diffs come from comparing the two snapshots. Undo restores the "before" snapshot, and asks first if a file changed again since. The bridge never commits or stages on its own. A commit happens only when you click Commit, and only for that session's files: it's built in a private index from your last commit plus those files as the session left them, your branch moves only if it is still where it was, and in your staging area only those files' entries change, so they show clean and everything else you staged stays as it was. A file you had changed before the session is listed and left out unless you tick it, and nothing commits if a file changed since the session. It's committed by git itself, so your hooks run (pre-commit sees only those files staged, and commit-msg can change the message) and commits are signed if you set git to sign them. If a hook fails, nothing is committed and its output is shown.
- **The app** (`web/`, built with Vite, React and TypeScript) is the map you use. It's served at leagueofagents.dev and by the bridge itself.

More detail is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Development

```bash
npm --prefix web ci
npm --prefix web run build
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

To host your own copy of the app, deploy the repo to Vercel (`vercel.json` sets the build), add your domain, and start the bridge with `--web https://your-domain`.

| Variable | Default | What it does |
|---|---|---|
| `LOA_WEB_DIR` | `web/dist` | Built app the bridge serves |
| `LOA_WEB_FILE` | none | Serve a single HTML file instead |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Contributions are accepted under the Apache License 2.0, and everyone follows the [code of conduct](CODE_OF_CONDUCT.md).

## License

[Apache 2.0](LICENSE)
