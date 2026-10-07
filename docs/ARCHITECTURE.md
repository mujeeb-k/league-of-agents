# Architecture (as built, 0.1.2)

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

A hosted https page can reach `http://127.0.0.1` in Chrome, Edge, Brave and Arc after the user allows it once (Chrome's local network prompt, since Chrome 142). Other browsers use the bridge's own URL, the local app, which needs no permission. WebSockets are avoided on purpose; plain fetch is more reliable across those rules.

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
| `GET /api/events?since=N[&delta=1]` | Long poll, up to 25s. Events: `state` (refetch), `progress` (run stream, status, checks). With `delta=1`, a `state` event for a finished or checked run carries `delta`: the run and its files as the map shows them (`emitRun()`), and the app applies it without refetching; other apps get the plain event |
| `POST /api/runs` | `{ agent, prompt, scope[], resumeFrom, lines?, context? }`. Starts an agent run. A scope entry is a folder (`src/`), a file, or lines of a file (`src/main.py:12-18`). For lines, `lines` holds their text and `context` the lines around them; the bridge finds them again (Selections, below) or answers 409 with `{ error, stale }` |
| `GET /api/file?path=` | A file's full text and its hash, for the editor |
| `POST /api/save` | `{ path, text, base }`. Writes the file as a run by `you`. 409 with the current `text` and `hash` if the file changed on disk since `base` |
| `POST /api/runs/:id/cancel` | Kills the agent |
| `POST /api/runs/:id/keep` | Marks kept |
| `POST /api/runs/:id/revert` | `{ force }`. 409 with `conflict[]` if files changed after the run |
| `POST /api/capture/start` and `/stop` | Used by the terminal hooks. They open and close only runs by `claude-terminal`; a new prompt closes a turn that never sent Stop (interrupted), and so does `SessionEnd` |

The file routes serve and write only files the map shows (`listFiles()`: no `.env*`, `.git`, `.loa` or skip-list paths), whose real path is inside the repo, and that are text under 400 KB.

### Runs

Every change becomes a run: an agent's, a save in the map's editor (`you`), or edits from anywhere else (watch mode, `detected`). One run is active at a time.

**Snapshots** (never your branch, index or working files):
- `writeTree()` writes the working tree as a git tree through a private index, `GIT_INDEX_FILE=.loa/snapshot.index`. The index starts from `read-tree HEAD` and is kept between snapshots, so git hashes only changed files; it starts again when HEAD moves. It runs `git add -A`, then removes untracked files whose names usually hold secrets, at any depth (`SECRET_FILES`: `.env`, `.env.*`, private keys, keystores, credential and secrets files; `ls-files --others --exclude-standard`), so a new `.env` or `id_rsa` never enters a snapshot. Tracked ones, such as `.env.example`, are in the repo's history already and are snapshotted like any file. Ignored files never enter one.
- `commitTree(tree, label, head)` makes a commit of that tree whose parent is HEAD, reachable only from the refs it is pinned to.
- `pin(id, which, commit)` writes `refs/loa/runs/<id>/before` or `/after`.
- `computeChanges(before, after)` runs `git diff --no-renames -U0` between the two and parses it into `{ path, created, deleted, pre[], hunks[{ at, del, add[] }] }`. `pre` is the file at `before`, up to its first 4,000 lines; `at` is a 0-based index into it. With `--no-renames`, a renamed file is a deleted file and a created one.
- `saveRun(run)` writes `.loa/runs/<id>.json`: agent, prompt, scope, sessionId, model (as the agent reports it: Claude Code's and Cursor's first `system`/`init` event or Claude Code's replies, read in `onAgentLine()`; Codex reports none), status, timestamps, summary, stream (last 400 entries), cost, checks, kept, reverted, outOfScope. Raw agent output is kept as-is in `.loa/runs/<id>.stream.jsonl` and `<id>.stderr.log`.

**Lifecycle:**
- `beginRun(opts)` first calls `settle()`, so changes made before the run are recorded as a run of their own and never count as the agent's. The result is the run's `before`, pinned at once. A second run while one is active gets 409.
- `startAgent(run, read)` writes `.loa/scope.json` for the scope lock and starts the agent's command (Agents, below).
- `finishRun(run, status)` takes the `after` snapshot of the whole tree, which becomes the new baseline, pins it, and computes the changes. So **every edit made during the run is counted in it, including your own** in another editor. `scopeViolations(run)` then lists changes outside the scope, for every agent, into `outOfScope`. Checks run in the background if any file changed.
- `revertRun(run, force)` compares each changed file with the run's `after`. If any changed since, it answers `{ conflict: [...] }` unless forced; otherwise it writes each file back from `before` and deletes the files the run created.
- A run's title is the first line of its prompt. Runs by watch mode and by `you` are titled by what changed ("Edited main.py", "Edited main.py and 2 more").

**Watch mode:** `watch()` watches the working tree (`fs.watch`, recursive). Once changed files have been quiet for 3 seconds (`LOA_QUIET_MS`), `onQuiet()` calls `settle()`. If HEAD moved (a branch switch, pull, commit or rebase), `rebase(true)` resets the baseline, **no run is recorded**, and a state event lets the map follow the new branch. Otherwise a snapshot that differs from the baseline becomes a `detected` run. Ignored paths never make one (`git check-ignore`); inside `.git` only `HEAD` and branch refs count. During an agent run, watch mode stays quiet: the run's own snapshots cover every change.

**Checks** from `loa.config.json`, or kept privately, run after any run that changed files. What the person allowed is kept outside the repo, in `~/.config/league-of-agents/repos/<sha256 of the repo root>.json` (`CHECKS_FILE`): `private`, found checks they turned on, and `approved`, the committed list they approved. A committed list runs only when it equals the approved one exactly; until then it is sent as `suggestedChecks` with `suggestedChecksFrom: 'repo'`, and any change waits again. The bridge won't start in a repo that tracks `.loa/`, so no committed file can stand in for this machine's state. `requires_free_port` skips a check if that port is in use; a check that can't start is "Couldn't run", never passed.

### Selections

Lines selected in the editor are held by their text and the lines around them, never by their numbers, which point at other code as soon as anything above them changes. The app (`web/src/lib/anchor.ts`) and the bridge (`relocate()` in `bridge/loa.mjs`) apply the same rule.

- **The anchor** (`anchorAt()`): the selected text, up to 3 lines before and 3 after it, and whether an identical copy exists in the file. A side counts only if it told this copy apart when it was taken: a side that another copy shares is dropped. The app takes the anchor again after every keep or move (`follow()` in `web/src/state/editing.ts`).
- **The rule** (`relocate()`):
  1. If the lines are still at their numbers and no copy could be there instead (the code is unique, or its anchor still matches there), keep them.
  2. Otherwise, follow the one copy whose stored lines on either side still match.
  3. Otherwise, for code that had no copy when it was anchored, follow its one exact match.
  4. Otherwise it is **changed**: nothing runs until lines are selected again or the selection is cleared.
  A selection points at the code that was picked, or says it can't; it never points at another copy.
- **The run sent on a selection** (`sending()`, then `follow()` with `grown()`): when the agent edits inside the selected lines and every line around them is unchanged, the selection takes the lines the agent left there. If it removed all of them, the selection is **removed**, and is never moved to a copy elsewhere.
- **The bridge** relocates the scope of `POST /api/runs` by the same rule, from one read of the file that the scope lock then holds. A request with `lines` but no `context` (an older app) is taken only where its numbers say.
- **What it can't tell:** twins with identical neighbours on both sides, once they move, are "changed"; a copy removed and another added in the same change keeps the copy count and can't be told apart from a move.

### The scope lock

- **Claude Code only, and only with the hooks.** The lock is Claude Code's `PreToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit`, running `runHook('pre')`. It exists only when the user said yes to the hooks (or added the plugin, whose hook calls the same code); without them a map run's edits are flagged after the run, not blocked. Claude Code is told its edit tools are blocked only when the hooks are on (`scopePreamble()`).
- **What it checks:** `.loa/scope.json`, written by `startAgent()` as `{ scope, ranges }`. A path outside every scope entry (`inScope()`) is refused with exit 2. For a line range, the hook applies the Edit, MultiEdit or Write to the file and checks `rangeKept()`: every line before and after the range must equal the file as the run found it, so the range may grow or shrink but nothing around it may change.
- **New files:** allowed only inside a selected folder; a selected file or lines allow none.
- **What it doesn't see:** under `--permission-mode acceptEdits`, Claude Code runs `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` in the repo without asking, and the hook doesn't check those; such a change outside the scope is flagged after the run. Closing this gap is planned.
- **After every run, for every agent,** `scopeViolations()` applies the same rules to the run's changes and lists what fell outside in `outOfScope`.

### Limits

`readTree()` builds the map's files for `/api/state`:
- `listFiles()`: tracked and untracked files git doesn't ignore, filtered to code (`CODE_EXT`) and off the skip list (`SKIP`: `node_modules`, `.git`, `.loa`, `dist`, `build`, `coverage`, `.next`, `.turbo`, lockfiles, `.env*`), sorted, **first 1,500** (`MAX_FILES`).
- Each file's **first 400 lines** (`MAX_LINES`) and its total line count. Files over **400 KB** (400,000 bytes) and binary files are left out.
- Non-code files are still in snapshots and reverts, just not on the map.
- One run at a time. macOS is the supported system; Linux may work but is untested; Windows isn't supported.

### Agents

| Agent | Command | Scope enforcement |
|---|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --permission-mode acceptEdits [--resume <session>]` | Preamble in prompt; with the hooks on, the PreToolUse hook blocks out-of-scope edits by its edit tools (exit 2); post-run check |
| Cursor | `cursor-agent -p --force --output-format stream-json [--resume] <prompt>` | Preamble, post-run diff check only |
| Codex (not yet verified with real output) | `codex exec --json --sandbox workspace-write [resume <thread_id>] <prompt>`; the session id is `thread_id` from `thread.started` | Preamble, post-run diff check only |
| Watch mode (`detected`) | Changes made outside a run, by any editor or agent | None: there is no scope |
| You (`you`) | A save from the editor on the map (`POST /api/save`) | None: the person chose the file |

Product rule: with the hooks on, Claude Code's edit tools are blocked live outside the scope. Everything else outside it, by any agent, is flagged after the run. The UI must not imply live blocking beyond that.

All agent processes get `LOA_MANAGED=1` (terminal hooks ignore them) and `LOA_SCOPE_FILE=.loa/scope.json`.

Note: `acceptEdits` lets Claude Code edit files and run `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` in the repo without asking; other shell commands are denied, since `-p` has no one to ask. Checks are run by the bridge instead.

## Web app (web/)

- Vite, React, strict TypeScript. shadcn/ui and Tailwind for the chrome, plain CSS for the canvas.
- State lives in typed modules (`src/state`, `src/lib`). Each screen region (scene, sidebar and so on) re-renders when its render function runs. The camera writes the canvas transform directly, outside React.
- `src/api` holds typed wire types and a client for every bridge route, plus the long-poll loop.
- Model: `FILES`, `DIRMAP`, `RUNS`. `layout()` places folders as columns by depth (wider than tall), files as a grid of 420×300 boxes inside each folder frame, and persists nothing yet.
- `viewOf(file)` returns rows for the current mode (before, after, diff) using the run's `pre` and `hunks`.
- Semantic zoom: below 34% the canvas shows the tree with a tile per file, its name and change ticks, and no line texture: painting a texture per tile made panning drop frames on large repos. Above it, code boxes with import lines.
- Demo mode uses a neutral sample repo (`src/demo`, a fictional webhook service). Live mode loads `/api/state` and polls events.

## Verified vs not

Verified with real Claude Code runs on scratch repos: selections that follow a rebase and a range that grows, the scope lock blocking an edit outside the selection with the hooks on and not blocking it with them off, and the prompt the agent receives. Every bridge route, watch mode, reverts, the hooks and the scope lock are covered by the end-to-end suites in `web/tests/e2e`, against the real bridge and stand-in agents.

Not yet verified with real runs: Cursor and Codex output (tested against stand-ins that follow their published formats).

## Known gaps

- Layout reflows when files are added or removed, and a rename moves a file to a new place on the map. Positions aren't kept across reloads.
- File contents (first 400 lines each) are sent in full with `/api/state`. Fine for hundreds of files, not tens of thousands.
- The scope lock needs the hooks and doesn't see shell commands (above).
- Cursor and Codex stream parsing is approximate.
