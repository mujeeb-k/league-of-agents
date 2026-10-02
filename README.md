<p align="center"><img src="brand/wordmark-600.png" alt="League of Agents" width="420"></p>

## What is League of Agents?

League of Agents is an agentic code canvas: a map of your codebase where you direct coding agents and review their work.

Coding agents change more code than anyone can review line by line. League of Agents shows your whole project as a map, and every change an agent makes lands on it. You see what changed, where, and whether it still works, then keep it or undo it.

It runs on your computer, works with the agents you already use, and is open source.

![Selecting a folder on the map, asking Claude Code for a change, then reviewing the run's diff file by file](docs/media/demo.gif)

## What you can do

- **See your whole project at once.** Every folder and file on one map. Zoom out for the shape, zoom in to read the code.
- **Point an agent at exact lines.** Select a file, a folder, or a few lines, and describe the change. Claude Code can't edit anything outside your selection; edits outside it by Codex or Cursor are flagged.
- **Edit files yourself.** Double-click a file's code to open it in the editor. Saved edits are recorded and can be undone like any agent run.
- **Update what depends on a change.** Rename a function, then ask the agent to update every file that uses it. The map shows each file it touched.
- **Review before you keep.** Switch between Before, After and Diff, step through changed files, then keep the run or undo it in one click.
- **Run your checks automatically.** Tests and type checks run after every change, so you know if it still works.

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

- macOS (Windows coming soon)
- git. On a Mac, this comes with Apple's command line developer tools: `xcode-select --install`
- Node 20 or later
- A git repository
- Claude Code installed and logged in, to run agents from the map. Without it, changes from any editor still show up.

## Works with

Claude Code, from the map or your terminal. Codex and Cursor are in beta. Changes from any other editor or agent show up through watch mode.

<sub>Built and tested with Claude Code. Codex and Cursor support follows their published formats and passes tests against them, but hasn't been fully verified with real runs yet.</sub>

## Using it

**From the map.** Select files, folders or lines, pick an agent, describe the change and press Enter. When the run finishes, review it and keep it or undo it. With a finished run selected, your next prompt continues the same session. Remove the "Follow-up" chip to start fresh.

**From your terminal.** Use Claude Code, Codex or Cursor as usual. With the hooks on, each prompt you send becomes a run on the map, titled by the prompt.

**From any editor.** Just work. When files you changed go quiet for a few seconds, League of Agents records them as one run, such as "Edited main.py". Files ignored by `.gitignore` never make a run, and branch switches and pulls are never recorded.

### Checks

If your repo has none set up, League of Agents looks for test and typecheck scripts and pytest, and offers to turn them on. They're kept in `.loa/`, out of your repo, unless you choose to share them with your team in `loa.config.json`. A check that can't run on your machine, because something it needs isn't installed, shows as "Couldn't run" instead of failing, and can be turned off in one click. See [`loa.config.example.json`](loa.config.example.json) to write your own.

### What it changes in your repo

- Creates `.loa/` for run records, and excludes it from git through `.git/info/exclude`.
- Stores run snapshots under private `refs/loa/` refs.
- Asks before adding hooks, then adds them to `.claude/settings.local.json` and `.codex/hooks.json` in the repo, and to `~/.cursor/hooks.json` for Cursor. Your own hooks are never changed.
- Never commits to your branch, never touches staging, and never reads `.env` files.

To remove everything:

```bash
npx leagueofagents-cli@latest uninstall
```

It stops League of Agents, removes its hooks, snapshots, `.loa/` and its lines in `.git/info/exclude`, and tells you what it removed. To remove only the hooks, use `hooks remove`.

## Privacy and security

League of Agents runs on your computer and never sends your code anywhere. The agents you use send code to their own providers, under their terms. leagueofagents.dev counts page views only: see the [privacy page](https://leagueofagents.dev/privacy). Who can reach League of Agents on your computer, and how it's protected, is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). Report security issues privately, as [SECURITY.md](SECURITY.md) explains.

## Not supported yet

- Windows. Linux is untested.
- Remote machines, SSH and dev containers. League of Agents must run on the same computer as your browser.
- Repos with more than 1,500 files. The map shows the first 1,500.
- Files over 400 KB, and diffs past a file's first 4,000 lines.
- More than one run at a time in the same repo.
- The website in Safari and Firefox. They use the local app instead.

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
| `--hooks`, `--no-hooks` | Asks once | Add or skip the agent hooks without asking |
| `LOA_CLAUDE_BIN` | `claude` | Claude Code command |
| `LOA_CODEX_BIN` | `codex` | Codex command |
| `LOA_CURSOR_BIN` | `cursor-agent` | Cursor command (newer installs may call it `agent`) |

Using Claude Code? There's also a plugin: `/plugin marketplace add mujeeb-k/league-of-agents-plugin`, then `/plugin install league-of-agents@league-of-agents`.

## How it works

League of Agents has two parts:

- **The bridge** (`bridge/loa.mjs`) runs on your computer, inside your repo. Node 20 or later, no dependencies. Before and after each run, it snapshots your files into a git commit using a private index, so your branch and staging area are never touched. Diffs come from comparing the two snapshots. Undo restores the "before" snapshot, and asks first if a file changed again since.
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
