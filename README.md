<p align="center"><img src="https://raw.githubusercontent.com/mujeeb-k/league-of-agents/main/brand/wordmark-600.png" alt="League of Agents" width="420"></p>

# League of Agents: The Agentic Code Canvas

See every change your agents make.

Point your coding agent at any file or block of code, then see every change on a map of your repo. Works with Claude Code, Codex, Cursor and more.

Codex and Cursor support is in beta: built to their published formats and tested against them, but not yet verified with real runs.

![Selecting a folder on the map, asking Claude Code for a change, then reviewing the run's diff file by file](https://raw.githubusercontent.com/mujeeb-k/league-of-agents/main/docs/media/demo.gif)

## Quick start

Two ways, in any project folder that is a git repo:

1. **Paste one line into your coding agent** (Claude Code, Codex, Cursor):

   ```text
   Read leagueofagents.dev/setup.md and set up League of Agents in this repo.
   ```

   It checks the repo, asks you before adding hooks, starts League of Agents and gives you the link.
2. **Or run it yourself:**

   ```bash
   npx leagueofagents-cli@latest
   ```

Requires macOS, git, Node 20 or later, and a git repo. Windows coming soon.

It starts the bridge in the background and opens your repo as a map in your default browser, already connected: run Claude Code from the canvas, and review each run as before, after and diff. In Chrome, Edge, Brave and Arc that is leagueofagents.dev, which the browser asks once to let reach your computer: choose Allow. In Safari, Firefox and others it is the local app the bridge serves, which needs no permission. The bridge keeps running after the terminal closes. `npx leagueofagents-cli@latest status` shows the link again; `stop` stops it. Each start makes a fresh link.

There is also a Claude Code plugin: `/plugin marketplace add mujeeb-k/league-of-agents-plugin`, then `/plugin install league-of-agents@league-of-agents`. It adds `/league-of-agents:open`, which starts League of Agents for the repo you're in, and records each prompt as a run.

Requirements:

- macOS. Windows coming soon.
- git (on a Mac, Apple's command line developer tools).
- Node 20 or later.
- A git repository. Run the command from inside it.
- Claude Code (`claude`) or Cursor (`cursor-agent`) installed and logged in. If Claude Code isn't, League of Agents says so and gives the command to fix it. Without either, changes made in any editor still show up as runs.

Options: `--port <n>` (default: the first free port from 43210), `--web <url>` (default https://leagueofagents.dev), `--hooks` / `--no-hooks`. The rest of this README covers how it works and how to develop it.

## How it is built

Two parts:

- `web/`: the web app (Vite, React, TypeScript). `npm --prefix web run build` produces a static site in `web/dist`. Deploy it anywhere static. Vercel works.
- `bridge/loa.mjs`: runs on your machine inside a repo. Zero dependencies, Node 20+.

## 1. The web app

The app runs at [https://leagueofagents.dev](https://leagueofagents.dev). Without a bridge connected, it runs in demo mode.

To host your own copy on Vercel:

1. Import the repo as a new project and keep the root directory as the repo root. `vercel.json` sets the install command, the build command, and the output directory (`web/dist`).
2. Add your domain under Settings, Domains.
3. Pass it to the bridge with `--web https://your-domain`.

`.vercelignore` keeps `bridge/` off the site.

## 2. Run the bridge in a repo

From npm: `npx leagueofagents-cli@latest`, as in the quick start. From a clone, build the web app once so the bridge can serve it: `npm --prefix ~/code/league-of-agents/web ci && npm --prefix ~/code/league-of-agents/web run build`.

```bash
cd ~/code/your-project
node ~/code/league-of-agents/bridge/loa.mjs
```

It prints two links:

- `http://127.0.0.1:43210/#t=…` works in every browser.
- `https://leagueofagents.dev/#bridge=43210&t=…` works in Chrome and Edge. Click Allow when Chrome asks for local network access.

The link connects the canvas to that repo. The token is saved in the browser, so reloading reconnects.

What the bridge changes in your repo, once:

- Creates `.loa/` for run records and adds it to `.git/info/exclude`.
- Only if you agree (it asks once, in the terminal): adds hooks so prompts you send in Claude Code, Codex and Cursor become runs titled by the prompt. They go in `.claude/settings.local.json` and `.codex/hooks.json` in the repo, and Cursor's in your own `~/.cursor/hooks.json` (Cursor reads project hooks only from the folder it opened), next to any hooks of your own, which are never changed. Remove the League of Agents hooks with `npx leagueofagents-cli@latest hooks remove`: each file goes back exactly as it was. Codex asks you to trust new hooks once (`/hooks` in Codex).

It never commits to your branch or touches staging, and never reads `.env` files. Run snapshots live under private `refs/loa/` refs.

To remove it all: `npx leagueofagents-cli@latest uninstall`. It stops the bridge, then removes its hooks, the `refs/loa/` snapshots, its lines in `.git/info/exclude` and `.loa/`, and says what it removed. The repo is left as if the bridge had never run. Who can reach the bridge, and what it guards against, is in [docs/THREAT-MODEL.md](https://github.com/mujeeb-k/league-of-agents/blob/main/docs/THREAT-MODEL.md).

## 3. Use it

**Steer Claude Code from the canvas.** Select files or folders, pick Claude Code, describe the change, press Enter. Claude Code runs headless in the repo. Edits outside the selection are blocked by the scope lock hook. When it finishes you get Before, After, Diff, check results, Keep and Revert. With a finished run selected, the next prompt continues the same session. Remove the "Follow-up" chip to start fresh.

**Use Claude Code in your terminal as usual.** Each prompt you send becomes a run on the canvas automatically, through the hooks, titled by the prompt and with exact start and stop.

**Codex in a terminal, Cursor in its editor (beta).** With the hooks, each prompt becomes a run the same way. Beta: these follow Codex's and Cursor's published hook formats and are tested against them, but are not yet verified with a real run.

**Cursor, any editor, any other agent.** Just work. Watch mode notices files you change outside a run and, once they have been quiet for a few seconds, records them as one run named for what changed, such as "Edited main.py", with Before, After, Diff, Keep and Revert. Files your `.gitignore` ignores never make a run, and a branch switch or pull is never recorded. If Cursor's CLI (`cursor-agent`) is installed, "Cursor" also appears as an agent you can run from the canvas (beta).

**Codex (beta).** Appears if the `codex` CLI is installed. Runs via `codex exec`. Not yet verified with a real run.

## 4. Checks

Checks run after every run that changed files. In a repo with none set up, League of Agents looks for test and typecheck scripts and pytest, and offers to turn them on. They are kept in `.loa/`, out of your repo, unless you choose to share them with your team: then they go in `loa.config.json` at the repo root. To write your own, see [`loa.config.example.json`](https://github.com/mujeeb-k/league-of-agents/blob/main/loa.config.example.json). `requires_free_port` skips a check when a dev server is holding that port.

A check that can't run on your machine, because a command or package it needs isn't installed, shows as "Couldn't run" with the error, not as a failure, and can be turned off in one click.

## 5. Options

| Flag or env | Default | Purpose |
|---|---|---|
| `--port` / `LOA_PORT` | first free from 43210 | Bridge port |
| `--web` / `LOA_WEB_URL` | `https://leagueofagents.dev` | Hosted site the second link points to |
| `--hooks` / `--no-hooks` | asks once | Add or leave out the hooks for Claude Code, Codex and Cursor, without asking |
| `LOA_CLAUDE_BIN` | `claude` | Claude Code binary |
| `LOA_CURSOR_BIN` | `cursor-agent` | Cursor CLI binary (newer installs may call it `agent`) |
| `LOA_CODEX_BIN` | `codex` | Codex CLI binary |
| `LOA_WEB_DIR` | `web/dist` | Folder of the built web app the bridge serves |
| `LOA_WEB_FILE` | none | Serve one HTML file instead, for example `path/to/index.html` |

## How runs are recorded

Before and after each run, the bridge snapshots every tracked and untracked file into a git commit using a private index, and pins it under `refs/loa/runs/<id>/`. Diffs come from `git diff` between the two. Revert restores files from the before snapshot and refuses if a file changed again later, unless you confirm.

## Not supported yet

- **Windows.** macOS only for now; Linux untested.
- **Remote machines, SSH and dev containers.** The bridge must run on the same computer as your browser, in a repo on that computer.
- **Repos over roughly 5,000 files.** Tested up to about 1,500; the first 400 lines of each file are shown.
- **More than one run at a time** per repo.
- **The hosted site in Safari or Firefox.** leagueofagents.dev needs Chrome or Edge to reach your computer; the local link the bridge prints works in every browser.

## Privacy

League of Agents runs on your machine and never sends your code anywhere. The agents you use send code to their own providers, under their terms. leagueofagents.dev counts page views only ([privacy page](https://leagueofagents.dev/privacy)).

## Contributing

See [CONTRIBUTING.md](https://github.com/mujeeb-k/league-of-agents/blob/main/CONTRIBUTING.md) to get started, and [docs/ARCHITECTURE.md](https://github.com/mujeeb-k/league-of-agents/blob/main/docs/ARCHITECTURE.md) for how the bridge and the app fit together. Contributions are accepted under the Apache License 2.0. Everyone follows the [code of conduct](https://github.com/mujeeb-k/league-of-agents/blob/main/CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](https://github.com/mujeeb-k/league-of-agents/blob/main/SECURITY.md) explains.
