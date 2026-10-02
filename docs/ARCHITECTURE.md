# Architecture (as built, v0.1)

## Pieces

```
Browser: web/dist (https://leagueofagents.dev on Vercel, or served by the bridge at 127.0.0.1)
   │  fetch + long polling, Bearer token
   ▼
Bridge: bridge/loa.mjs (Node 20+, zero deps, runs inside the target repo)
   │  spawns CLIs, installs hooks, snapshots with git
   ▼
Agents: Claude Code (claude -p), Cursor (cursor-agent -p), Codex (codex exec); watch mode records changes made outside a run
```

A hosted https page can reach `http://127.0.0.1` in Chrome and Edge after the user allows local network access. Other browsers use the bridge's own URL. WebSockets are avoided on purpose; plain fetch is more reliable across those rules.

## Bridge

Installed for users as the npm package `leagueofagents-cli` (`npx leagueofagents-cli@latest`), which ships `bridge/loa.mjs` and the built `web/dist`.

Commands, from inside a git repo:
- `start` (also with no command): runs the bridge in the background, in its own process group, so it outlives the terminal or agent session that started it; waits until it answers, prints the local link and opens it in the default browser (`--no-open` doesn't). If it is already running for the repo, it shows that one.
- `stop`, `status`: find it through `.loa/bridge.json` (port, token, process id), and only when it answers with that token, or says it is locked.
- One bridge per repo: `start` and `serve` look for a live bridge through `.loa/bridge.json` first and open it instead of starting another, so the hooks, which find the bridge there, always reach the bridge that holds the run.
- A run never ends without its changes. A run still open when the bridge stops is closed as interrupted with an after snapshot; one left open by a crash is closed the same way at the next start; a hook run whose Stop never arrives is closed after 30 minutes with no file changes (`LOA_HOOK_IDLE_MS`), so it can't keep watch mode quiet.
- `serve`: the bridge in the foreground, as the tests run it.
- `hooks remove`: takes out the hooks it added.
- `uninstall`: stops the bridge, then removes the hooks, every `refs/loa/` ref, the lines it added to `.git/info/exclude` (recorded in `.loa/excluded.json`; for older installs only `.loa/`), and `.loa/`. It lists what it removed.

Options: `--port 43210`, `--web https://leagueofagents.dev` (the hosted link it also prints), `--hooks` / `--no-hooks`, `--app-path /` (where the app is served and linked; `/app/` once the site has a homepage).

On start it:

- Writes `.loa/bridge.json` with port, token, the hooks choice and its process id. Every start makes a fresh token, so a link from an earlier run is rejected.
- Adds `.loa/` and `.claude/settings.local.json` to `.git/info/exclude`.
- Hooks go in only with consent: asked once in the terminal and remembered in `.loa/bridge.json`; `--hooks` and `--no-hooks` decide without asking; without a terminal to ask in, none. Each agent's own file gets entries next to the user's own hooks, which are never changed; the original bytes are kept in `.loa/hooks-backup.json`, and `hooks remove` restores them exactly (or deletes a file it created). All hooks run `.loa/bridge.mjs`, a copy of the bridge made at start.
- Claude Code, in `.claude/settings.local.json`:
  - `PreToolUse` on `Edit|Write|MultiEdit|NotebookEdit` → `hook pre`: the scope lock, for files, folders and line ranges.
  - `UserPromptSubmit` → `hook start`: opens a run for terminal sessions.
  - `Stop` → `hook stop`: closes it.
  - `SessionEnd` → `hook stop`: closes a turn that was interrupted, since Claude Code sends no Stop then.
- Codex (beta), in `.codex/hooks.json`: `UserPromptSubmit` → `hook start codex` (prompt, `session_id`), `Stop` → `hook stop codex` (`last_assistant_message` as the reply). Codex asks the user to trust new hooks.
- Cursor (beta), in the user's `~/.cursor/hooks.json` (`version: 1`): `beforeSubmitPrompt` → `hook start cursor` (prompt, `conversation_id`), `stop` → `hook stop cursor` (`status`: aborted becomes cancelled, error becomes failed). Each answers Cursor with JSON (`{"continue":true}`, `{}`).
  - Cursor reads project hooks only from the folder it opened, which is often the folder holding the repo, so its hooks go in the user's own file, which it reads for every workspace.
  - The hook finds the repo: each workspace root if it is in a repo, otherwise each folder directly inside it with a running bridge; files attached to the prompt narrow it down. A prompt records only when one repo is left (watch mode covers the rest). A stop goes to every candidate, and a bridge closes a hook run only on a stop from the same conversation.
  - Cursor also runs Claude Code's hook files; a payload with `cursor_version` is treated as Cursor's, so both sets of hooks give one run.
  - The file is shared by every repo: the latest to install owns the League of Agents entries, and only it removes them.
- Detects which agent CLIs are on PATH.

### API

All `/api/*` routes need `Authorization: Bearer <token>`; a token in the URL is not accepted. Before the token is read (see `docs/THREAT-MODEL.md`):
- the Host must be `127.0.0.1:<port>` or `localhost:<port>`, or the request gets 403 (DNS rebinding);
- an Origin must be the bridge's own, the hosted app's (`--web`, `LOA_WEB_URL`, default `https://leagueofagents.dev`), or the request gets 403 (a preview deployment is trusted by starting the bridge with `--web <its address>`), preflights included;
- an API request with no Origin that the browser marks `Sec-Fetch-Site: cross-site` or `same-site` gets 403.

CORS echoes only allowed origins and sends `Access-Control-Allow-Private-Network: true`. A wrong token is answered after a delay that doubles each time (100 ms up to 5 s). After 50, every API request gets 423 until the bridge restarts; the log and `status` say so, and `start` replaces a locked bridge.

| Route | Purpose |
|---|---|
| `GET /` and other non-API paths | Serves the built app from `web/dist` (`LOA_WEB_DIR`), or one file with `LOA_WEB_FILE` |
| `GET /api/state` | Repo name, branch and absolute root (for opening files in another editor), agents, file tree with first 400 lines per file, all runs, active run id, event seq, the bridge version (`package.json`; the app shows an update banner below `MIN_BRIDGE`) |
| `GET /api/events?since=N` | Long poll, up to 25s. Events: `state` (refetch), `progress` (run stream, status, checks) |
| `POST /api/runs` | `{ agent, prompt, scope[], resumeFrom }`. Starts an agent run. A scope entry is a folder (`src/`), a file, or lines of a file (`src/main.py:12-18`) |
| `GET /api/file?path=` | A file's full text and its hash, for the editor |
| `POST /api/save` | `{ path, text, base }`. Writes the file as a run by `you`. 409 with the current `text` and `hash` if the file changed on disk since `base` |
| `POST /api/runs/:id/cancel` | Kills the agent |
| `POST /api/runs/:id/keep` | Marks kept |
| `POST /api/runs/:id/revert` | `{ force }`. 409 with `conflict[]` if files changed after the run |
| `POST /api/capture/start` and `/stop` | Used by the terminal hooks. They open and close only runs by `claude-terminal`; a new prompt closes a turn that never sent Stop (interrupted), and so does `SessionEnd` |

The file routes serve and write only files the map shows (`listFiles()`: no `.env*`, `.git`, `.loa` or skip-list paths), whose real path is inside the repo, and that are text under 400 KB.

### Runs

- Before and after snapshots: a private index, `GIT_INDEX_FILE=.loa/snapshot.index`, started from `read-tree HEAD` and kept between snapshots so git hashes only changed files (restarted when HEAD moves); `add -A` minus untracked `.env` and `.env.*` files at any depth, `write-tree`, `commit-tree`. Pinned at `refs/loa/runs/<id>/before` and `/after`. Branch, staging, and working files are never touched. Untracked `.env` files never enter a snapshot; tracked ones, such as `.env.example` templates, are already in the repo's history and are snapshotted like any file.
- Changes: `git diff -U0 before after`, parsed into `{ path, created, deleted, pre[], hunks[{ at, del, add[] }] }`. `pre` is the file at `before`. `at` is a 0-based index into `pre`.
- Raw agent output is kept as-is in `.loa/runs/<id>.stream.jsonl` (stdout) and `<id>.stderr.log`, for fixtures and debugging.
- Stored at `.loa/runs/<id>.json` with agent, prompt, scope, sessionId, status, timestamps, summary, stream (last 400 entries), cost, checks, kept, reverted, outOfScope.
- One active run at a time.
- A run's title is the first line of its prompt. Runs by watch mode and by `you` are titled by what changed.
- Line ranges are held by their surroundings: after a change, every line before and after the range must equal the file as the run found it. At the start of an agent run the bridge writes `.loa/scope.json` as `{ scope, ranges }`, where `ranges` holds each range file's text, so the PreToolUse hook can apply each Edit, MultiEdit or Write and check it. After the run the same rule flags changes outside the range for every agent.
- Watch mode: the bridge watches the working tree (`fs.watch`, recursive). The baseline is a snapshot of the tree as last seen: at start, after every run, and after a revert. Once the files have been quiet for 3 seconds (`LOA_QUIET_MS`), a new snapshot that differs from the baseline becomes a `detected` run titled by what changed ("Edited main.py", "Edited main.py and 2 more"). Ignored files never enter a snapshot, and a quiet period in which every changed path is ignored skips the snapshot (`git check-ignore`). Inside `.git` only `HEAD` and branch refs count. If HEAD moved (branch switch, pull, commit), the baseline resets, nothing is recorded, and a state event lets the map follow the new branch and its files. During a run, watch mode stays quiet, so the run's own snapshots cover every change. A run first records any pending changes as their own run, so they never count as the agent's.
- Checks from `loa.config.json` run after any run that changed files, in the background. `requires_free_port` skips a check if that port is in use.
- Revert writes each file back from `before` and deletes created files. It refuses if the current file differs from `after`, unless forced.

### Agents

| Agent | Command | Scope enforcement |
|---|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits [--resume <session>]` | Preamble in prompt, PreToolUse hook blocks out-of-scope edits (exit 2), post-run diff check |
| Cursor | `cursor-agent -p --force --output-format stream-json [--resume] <prompt>` | Preamble, post-run diff check only |
| Codex (not yet verified with real output) | `codex exec --json --sandbox workspace-write [resume <thread_id>] <prompt>`; the session id is `thread_id` from `thread.started` | Preamble, post-run diff check only |
| Watch mode (`detected`) | Changes made outside a run, by any editor or agent | None: there is no scope |
| You (`you`) | A save from the editor on the map (`POST /api/save`) | None: the person chose the file |

Product rule: Claude Code runs are blocked live when they edit outside the scope. Cursor and Codex runs are flagged after the run. The UI must not imply live blocking for those agents.

All agent processes get `LOA_MANAGED=1` (terminal hooks ignore them) and `LOA_SCOPE_FILE=.loa/scope.json`.

Note: `acceptEdits` lets Claude Code edit files but not run shell commands headless. Checks are run by the bridge instead.

## Web app (web/)

- Vite, React, strict TypeScript. shadcn/ui and Tailwind for the chrome, plain CSS for the canvas.
- State lives in typed modules (`src/state`, `src/lib`). Each screen region (scene, sidebar and so on) re-renders when its render function runs. The camera writes the canvas transform directly, outside React.
- `src/api` holds typed wire types and a client for every bridge route, plus the long-poll loop.
- Model: `FILES`, `DIRMAP`, `RUNS`. `layout()` places folders as columns by depth (wider than tall), files as a grid of 420×300 boxes inside each folder frame, and persists nothing yet.
- `viewOf(file)` returns rows for the current mode (before, after, diff) using the run's `pre` and `hunks`.
- Semantic zoom: below 34% the canvas shows the tree with file lists and line-length bars with change ticks. Above it, code boxes with import lines.
- Demo mode uses a neutral sample repo (`src/demo`, a fictional webhook service). Live mode loads `/api/state` and polls events.

## Verified vs not

Verified in a scratch repo shaped like the test bed, with `tests/fixtures/fake-claude.mjs` standing in for Claude Code:

- Connect from the bridge URL and from a different origin. Token removed from the URL, reconnect on reload.
- Canvas-launched run: real git diff including a new file, checks shown, camera flies to the change.
- Terminal hook capture. Scope lock exit codes. Watch mode. Revert and drift refusal.

Not yet verified: real Claude Code and Cursor output formats, and Codex (tested only against a stand-in).

## Known gaps

- Layout reflows when files are added or removed. Not fitted to the screen's aspect ratio.
- File contents are sent in full with `/api/state`. Fine for hundreds of files, not thousands.
- Cursor and Codex stream parsing is approximate.
- No automated tests for the bridge.
