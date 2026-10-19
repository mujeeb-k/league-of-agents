# Architecture (as built, 0.2.0)

## Pieces

```
Browser: web/dist (https://leagueofagents.dev on Vercel, or served by the bridge at 127.0.0.1)
   │  fetch + long polling, Bearer token
   ▼
Bridge: bridge/loa.mjs and bridge/lib/ (Node 20+, zero deps, runs inside the target repo)
   │  spawns CLIs, installs hooks, snapshots with git, holds sessions in macOS's sandbox
   ▼
Agents: Claude Code (claude -p), Cursor (cursor-agent -p), Codex (codex exec), and ACP harnesses (Hermes, DeepSeek Harness, and any the person adds), over the Agent Client Protocol; watch mode records changes made outside a run
```

A hosted https page can reach `http://127.0.0.1` in Chrome, Edge, Brave and Arc after the user allows it once (Chrome's local network prompt, since Chrome 142). Other browsers use the bridge's own URL, the local app, which needs no permission. WebSockets are avoided on purpose; plain fetch is more reliable across those rules.

## Bridge

Installed for users as the npm package `leagueofagents-cli` (`npx leagueofagents-cli@latest`), which ships `bridge/loa.mjs`, `bridge/lib/` and the built `web/dist`. `loa.mjs` is the entry; the code is in `bridge/lib/`, a module per concern, and the functions named below are there.

Its records for a repo are kept outside it, in `~/.config/league-of-agents/repos/<first 32 of the sha256 of the repo root>/` (`LOA`, `loaOf()` in `util.mjs`), where no git command run in the repo reaches them: `bridge.json`, `bridge.log`, `runs/`, the snapshot index, the hooks' copy of the bridge, `layout.json`, `hooks-backup.json`, `excluded.json`, and the store, `git/`. The repo holds only `.loa/bridge.mjs`, one line that loads that copy for the Claude Code plugin's hooks. A start finds what a bridge before this one kept in the repo's `.loa/` and under `refs/loa/` and moves it there (`moveLegacy()` in `repo.mjs`): each snapshot becomes a commit of the same files in the store, the runs are rewritten to name it, and only then are the repo's refs and files removed. A bridge of an earlier version still running in the repo is stopped by `stop` and `uninstall`; anything else refuses to start beside it.

Commands, from inside a git repo:
- `start` (also with no command): runs the bridge in the background, in its own process group, so it outlives the terminal or agent session that started it; waits until it answers, prints the local link and opens it in the default browser (`--no-open` doesn't). If it is already running for the repo, it shows that one.
- `stop`, `status`: find it through `bridge.json` (port, token, process id), and only when it answers with that token, or says it is locked.
- One bridge per repo: `start` and `serve` look for a live bridge through `bridge.json` first and open it instead of starting another, so the hooks, which find the bridge there, always reach the bridge that holds the run.
- A run never ends without its changes. A run still open when the bridge stops is closed as interrupted with an after snapshot; one left open by a crash is closed the same way at the next start; a hook run whose Stop never arrives is closed after 30 minutes with no file changes (`LOA_HOOK_IDLE_MS`), so it can't keep watch mode quiet.
- `serve`: the bridge in the foreground, as the tests run it.
- `hooks remove`: takes out the hooks it added.
- `uninstall`: stops the bridge, then removes the hooks, the lines it added to `.git/info/exclude` (recorded in `excluded.json`; for older installs only `.loa/`), its folder for the repo, `.loa/`, and any `refs/loa/` ref an earlier version left. It lists what it removed.

Options: `--port 43210`, `--web https://leagueofagents.dev` (the hosted link it also prints), `--local` (no website: the local app only, and no other origin may call the API; `start` replaces a running bridge whose website differs, recorded as `web` in `bridge.json`), `--hooks` / `--no-hooks`, `--app-path /` (where the app is served and linked; `/app/` once the site has a homepage).

On start it:

- Writes `bridge.json` with port, token, the hooks choice and its process id. Every start makes a fresh token, so a link from an earlier run is rejected.
- Adds `.loa/` and `.claude/settings.local.json` to `.git/info/exclude`.
- Hooks go in only with consent: asked once in the terminal and remembered in `bridge.json`; `--hooks` and `--no-hooks` decide without asking; without a terminal to ask in, none. Each agent's own file gets entries next to the user's own hooks, which are never changed; the original bytes are kept in `hooks-backup.json`, and `hooks remove` restores them exactly (or deletes a file it created). All hooks run `bridge.mjs` in the records folder, which loads a copy of the bridge made at start.
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

All `/api/*` routes need `Authorization: Bearer <token>`; a token in the URL is not accepted. A link the bridge prints carries a code good for one use, which the page exchanges for a session token of its own (`server.mjs`); the bridge's own token is never in a link. Before the token is read (see `docs/THREAT-MODEL.md`):
- the Host must be `127.0.0.1:<port>` or `localhost:<port>`, or the request gets 403 (DNS rebinding);
- an Origin must be the bridge's own, the hosted app's (`--web`, `LOA_WEB_URL`, default `https://leagueofagents.dev`), or the request gets 403 (a preview deployment is trusted by starting the bridge with `--web <its address>`), preflights included;
- an API request with no Origin that the browser marks `Sec-Fetch-Site: cross-site` or `same-site` gets 403.

CORS echoes only allowed origins and sends `Access-Control-Allow-Private-Network: true`. A wrong token, or an unknown link code, is answered after a delay that doubles each time (100 ms up to 5 s); the right token always works.

| Route | Purpose |
|---|---|
| `GET /` and other non-API paths | Serves the built app from `web/dist` (`LOA_WEB_DIR`), or one file with `LOA_WEB_FILE` |
| `GET /api/state` | Repo name, branch and absolute root (for opening files in another editor), agents, file tree with first 400 lines per file, all runs without each file as the run found it or its activity, the runs at work, event seq, the bridge version (`package.json`; the app shows an update banner below `MIN_BRIDGE`). `?root=` maps one folder |
| `GET /api/runs/:id`, `/before?path=`, `/steps`, `/steps/:n` | A run's details, asked for when it is opened: each file as it found it and its activity; one file whole as it found it; its steps (each tool call, `steps.mjs`); a file as one step left it |
| `POST /api/runs/:id/wants` | Allow or refuse a file a session asked to change outside its section |
| `POST /api/runs/:id/put-back` | Restores a file a shell command wrote outside its section, as the command left it, once the person asks |
| `GET`, `POST /api/runs/:id/commit` | What a commit of the run's files would hold, and the commit itself (`commit.mjs`, below) |
| `GET /api/folders`, `POST /api/heads` | The repo's folders, for a repo larger than a map; files' lengths and first lines, asked for as a large map shows them |
| `POST /api/checks`, `/api/checks/off`, `/api/hooks/remove` | Turn found or shared checks on, one off, and take the hooks out |
| `GET /api/events?since=N[&delta=1]` | Long poll, up to 25s. Events: `state` (refetch), `progress` (run stream, status, checks). With `delta=1`, a `state` event for a finished or checked run carries `delta`: the run and its files as the map shows them (`emitRun()`), and the app applies it without refetching; other apps get the plain event |
| `POST /api/runs` | `{ agent, prompt, scope[], resumeFrom, lines?, context? }`. Starts an agent run. A scope entry is a folder (`src/`), a file, or lines of a file (`src/main.py:12-18`). For lines, `lines` holds their text and `context` the lines around them; the bridge finds them again (Selections, below) or answers 409 with `{ error, stale }` |
| `POST /api/attribution/export` | `{ format, files }`: writes who wrote each line, as the app worked it out, to a git note on HEAD, for files whose working copy is HEAD's (`exportAttribution()`): an Agent Trace record (spec 0.1.0) in `refs/notes/agent-trace`, or a Git AI log (agent lines) in `refs/notes/ai`, never over one there. No prompts. Only from the export dialog |
| `GET /api/authors?path=` | Who wrote each line of a file at HEAD as git records it, read only (`recordedAuthors()`): `git blame`, then a Git AI note on the line's commit (`refs/notes/ai`, Git AI Standard v3.0.0, `parseGitAiNote()`), else a `Co-authored-by` trailer naming an agent (a whole commit: mixed) |
| `GET /api/layout`, `POST /api/layout` | The map's layout, kept in `layout.json` in the records folder (`LAYOUT_FILE`); the app keeps it in the browser with bridges that answer 404 |
| `GET /api/file?path=` | A file's full text and its hash, for the editor |
| `POST /api/save` | `{ path, text, base }`. Writes the file as a run by `you`. 409 with the current `text` and `hash` if the file changed on disk since `base` |
| `POST /api/runs/:id/cancel` | Kills the agent |
| `POST /api/runs/:id/keep` | Marks kept |
| `POST /api/runs/:id/revert` | `{ force, shared[] }`. 409 with `conflict[]` if files changed after the run. `shared` names the files another session edited too that go back with it; the rest of those are left, named in `left[]` and kept on the run (`left`). A shared file whose other session still works is refused (`shared-busy`), in a revert and in a commit |
| `POST /api/capture/start` and `/stop` | Used by the terminal hooks. They open and close only runs by `claude-terminal`; a new prompt closes a turn that never sent Stop (interrupted), and so does `SessionEnd` |

The file routes serve and write only files the map shows (`listFiles()`: no `.env*`, `.git`, `.loa` or skip-list paths), whose real path is inside the repo, and that are text under 400 KB.

### Runs

Every change becomes a run: an agent's, a save in the map's editor (`you`), or edits from anywhere else (watch mode, `detected`). Runs on sections that don't overlap work at the same time; a run on the whole repository works alone (Sessions at once, below).

**Snapshots** (never your branch, index, refs or working files):
- They live in the store, a bare repository in the records folder (`STORE`). The bridge's own git runs with `GIT_OBJECT_DIRECTORY` set to the store's objects and the repo's as an alternate (`envOf()`): it reads both, and what it writes goes into the store. Git as the person's own (a commit, a note) runs with `repo: true` and writes into the repo; a commit first copies the files it holds from the store (`intoRepo()`).
- `writeTree()` writes the working tree as a git tree through a private index, `GIT_INDEX_FILE=snapshot.index` in the records folder. The index starts from `read-tree HEAD` and is kept between snapshots, so git hashes only changed files; it starts again when HEAD moves. It runs `git add -A`, then removes untracked files whose names usually hold secrets, at any depth (`SECRET_FILES`: `.env`, `.env.*`, private keys, keystores, credential and secrets files; `ls-files --others --exclude-standard`), so a new `.env` or `id_rsa` never enters a snapshot. Tracked ones, such as `.env.example`, are in the repo's history already and are snapshotted like any file. Ignored files never enter one.
- `commitTree(tree, label)` makes a commit of that tree with no parent: a snapshot is its files, never the history it was taken on.
- `pin(id, which, commit)` writes `refs/loa/runs/<id>/before` or `/after` in the store, through `keep()`: first the store gets its own copy of every object the snapshot reaches that no earlier pin reaches (`rev-list --objects`, then `pack-objects` into the store), so a commit reset away and pruned in the repo takes nothing a run needs. The baseline is pinned the same way (`refs/loa/base`); the first copy, of the whole working tree, runs while the bridge answers.
- `computeChanges(before, after)` runs `git diff --no-renames -U0` between the two and parses it into `{ path, created, deleted, pre[], hunks[{ at, del, add[] }] }`. `pre` is the file at `before`, up to its first 4,000 lines; `at` is a 0-based index into it. With `--no-renames`, a renamed file is a deleted file and a created one in the bridge's records, and reverting them is unchanged; the bridge names each rename git finds (`git diff -M`, `renamedFrom`), and the app shows one change under the new name, from the old text to the new (`liveRun()`, a line diff from `lib/textdiff.ts`), in the old name's place (`carryRenames()` in `lib/layout.ts`).
- `saveRun(run)` writes `runs/<id>.json`: agent, prompt, scope, sessionId, model (as the agent reports it: Claude Code's and Cursor's first `system`/`init` event or Claude Code's replies, read in `onAgentLine()`, or an ACP session's model, `acpModel()`; Codex reports none), status, timestamps, summary, stream (last 400 entries), cost, checks, kept, reverted, outOfScope. Raw agent output is kept as-is in `runs/<id>.stream.jsonl` and `<id>.stderr.log`. For Claude Code runs and ACP harnesses that show their edits as diffs, `agentLines` holds, per file, the [from, to] ranges of added lines (indexes in the file after the run) whose text the agent put in through its Edit, MultiEdit or Write tools (`noteWrites()` as the stream or the terminal transcript is read, `agentLinesOf()` at `finishRun()`); lines it changed any other way are not in it. `pruneRuns()`, at start and after each run, deletes the runs past both limits, the newest 500 (`KEEP_RUNS`) and the last 30 days (`KEEP_DAYS`): their files and their `refs/loa/runs/<id>/` refs in the store, which git then tidies (`gc --auto`, with git's own two weeks' grace).

**Lifecycle:**
- `beginRun(opts)` first calls `settle()`, so changes made before the run are recorded as a run of their own and never count as the agent's. The result is the run's `before`, pinned at once. A run whose section overlaps one at work gets 409 (`clash()`).
- `startAgent(run, read)` writes `scope-<id>.json` in the records folder for the scope lock and starts the agent's command (Agents, below).
- `finishRun(run, status)` takes the `after` snapshot of the whole tree, which becomes the new baseline, pins it, and computes the changes. So **every edit made during the run is counted in it, including your own** in another editor. `scopeViolations(run)` then lists changes outside the scope, for every agent, into `outOfScope`. Checks run in the background if any file changed.
- `revertRun(run, force)` compares each changed file with the run's `after`. If any changed since, it answers `{ conflict: [...] }` unless forced; otherwise it writes each file back from `before` and deletes the files the run created.
- A run's title is the first line of its prompt. Runs by watch mode and by `you` are titled by what changed ("Edited main.py", "Edited main.py and 2 more").

**Sessions at once** (`parallel.mjs`):
- From the first run starting to the last ending, the baseline stays where it was (an epoch). A run that starts beside others begins on a snapshot of that moment (`startingPoint()`).
- `ownChanges(run, changes)` gives a run that overlapped others every file its edit tools named, wherever the file is, and whatever else changed in its own section while it worked (its commands name no file). A file it edited inside another session's section is said on both runs. What changed outside every section that no edit tool named is said on the run and left for the epoch's end.
- A file two sessions' edit tools both named is shared (`share()`): `shared: [{ path, with[] }]` on both runs, each naming the other. `revertRun()` leaves it exactly as it is and `commitPreview()` leaves it out, unless the request names it. The preview lists such files in `shared`, and in `later` the ones changed since the run ended, which can't go in with it. The app asks in its Revert and Commit dialogs. A file one session changed only by a command names no file, so it is never seen as shared.
- `closeEpoch()` records whatever no run owns (an edit by hand, an agent outside its section) as a run of its own, by none of them.
- Checks wait for the last session (`checksFor()`), run once, and every run of the epoch gets the same results.
- `commitRun()` (`commit.mjs`) commits one run's files with the person's message: built in a private index from HEAD plus those files, by git itself so hooks run, and only if the branch is still where it was. Commits are made one at a time.

**Watch mode:** `watch()` watches the working tree (`fs.watch`, recursive). Once changed files have been quiet for 3 seconds (`LOA_QUIET_MS`), `onQuiet()` calls `settle()`. If HEAD moved (a branch switch, pull, commit or rebase), `rebase(true)` resets the baseline, **no run is recorded**, and a state event lets the map follow the new branch. Otherwise a snapshot that differs from the baseline becomes a `detected` run. Ignored paths never make one (`git check-ignore`); inside `.git` only `HEAD` and branch refs count. During an agent run, watch mode stays quiet: the run's own snapshots cover every change. If watching can't start or fails (on Linux, `ENOSPC` when the limit on watched folders is reached), `watchFailed()` logs it and puts why in the state (`watchOff`), and the app says that edits outside a run aren't recorded.

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

- **On macOS, the sandbox** (`sandbox.mjs`): `lockOfRun()` says how a run is held. Hermes and DeepSeek Harness run inside `sandbox-exec` whole. Claude Code (2.1.295 or later) runs outside it, each of its shell commands inside, and a hook passed on its command line (`--settings`, `hook.mjs` hold) holds its file tools. Cursor and Codex are not held: `lockOfRun()` answers `none` for them. The README's "The sandbox on macOS" lists what a held session can read and write.
- **Elsewhere, Claude Code's hook.** Each run on a selection is started with a `PreToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit`, running `runHook('pre')`, on its command line: nothing is written to the repo for it. With the hooks on, each shell command is bracketed by two snapshots and what it changed outside the scope is put back (`shell.mjs`).
- **What it checks:** `scope-<id>.json`, written by `startAgent()` as `{ scope, ranges }`. A path outside every scope entry (`inScope()`) is refused with exit 2. For a line range, the hook applies the Edit, MultiEdit or Write to the file and checks `rangeKept()`: every line before and after the range must equal the file as the run found it, so the range may grow or shrink but nothing around it may change.
- **New files:** allowed only inside a selected folder; a selected file or lines allow none.
- **A write outside the scope asks.** A refused edit becomes a question on the run's card (`blocked()` in `runs.mjs`); Allow adds the file to the scope and the session carries on.
- **After every run, for every agent,** `scopeViolations()` applies the same rules to the run's changes and lists what fell outside in `outOfScope`.

### Limits

`readTree()` builds the map's files for `/api/state`:
- `listFiles()`: tracked and untracked files git doesn't ignore, filtered to code (`CODE_EXT`) and off the skip list (`SKIP`: `node_modules`, `.git`, `.loa`, `dist`, `build`, `coverage`, `.next`, `.turbo`, lockfiles, `.env*`), sorted. The app asks for **5,000** (`MAP_MAX` in `web/src/api/client.ts`; the bridge gives at most 10,000, `MAX_FILES`). A larger repository maps one of its folders (`/api/folders`, `?root=`).
- Each file's **first 400 lines** (`MAX_LINES`) and its total line count. Files over **16 MB** (`MAX_BYTES`) and binary files are left out.
- Non-code files are still in snapshots and reverts, just not on the map.
- Up to five sessions started from one prompt (`MAX_SESSIONS`), on sections that don't overlap. macOS is the supported system; Linux passes the test suite in CI (`.github/workflows/linux.yml`) but hasn't been tried with a real agent; Windows isn't supported.

### Agents

| Agent | Command | Scope enforcement |
|---|---|---|
| Claude Code | `claude -p <prompt> --output-format stream-json --verbose --setting-sources user --permission-mode acceptEdits --settings <hooks> [--resume <session>]`; `dontAsk` where the sandbox holds it | Preamble in prompt; held by the sandbox and its hook on macOS, by the PreToolUse hook elsewhere (exit 2); post-run check |
| Cursor | `cursor-agent -p --force --output-format stream-json [--resume] <prompt>` | Preamble, post-run diff check only |
| Codex (no real run recorded yet) | `codex exec --json --sandbox workspace-write [resume <thread_id>] <prompt>`; the session id is `thread_id` from `thread.started` | Preamble, post-run diff check only |
| ACP harnesses | `hermes acp` (found once `hermes acp --check` passes), `dsh --profile acp`, or a command from the person's own `~/.config/league-of-agents/agents.json` (`ACP`); `startAcp()` speaks JSON-RPC 2.0 over stdio: `initialize` (no file system or terminal offered), `session/new` or `session/resume`, `session/prompt`. The model is the session's `model` config option or `models.currentModelId` (`acpModel()`); message chunks are the reply, tool calls the activity, `diff` content, or an edit tool's own arguments (dsh's `edit` and `write`), the agent's lines; updates replayed before the prompt are skipped | Preamble; `permitAcp()` allows an edit only inside the repo and the scope and refuses every other request (commands too), so a harness that asks first is blocked live: Hermes asks before edits, and dsh runs with `DSH_PERMISSION_MODE=read-only`, where its sandbox holds each write until it asks (its request names only the call, so tool calls are kept by id); post-run diff check |
| Watch mode (`detected`) | Changes made outside a run, by any editor or agent | None: there is no scope |
| You (`you`) | A save from the editor on the map (`POST /api/save`) | None: the person chose the file |

Product rule: a session the sandbox holds can't write outside its section. Without it, Claude Code's edit tools are blocked live outside the scope, and so are edits by an ACP harness that asks before editing (Hermes; dsh in its read-only mode). Everything else outside it, by any agent, is flagged after the run. Cursor and Codex are never held. The UI must not imply live blocking beyond that.

All agent processes get `LOA_MANAGED=1` (terminal hooks ignore them) and `LOA_SCOPE_FILE`, that run's `scope-<id>.json`.

Note: `acceptEdits` lets Claude Code edit files and run `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` in the repo without asking; other shell commands are denied, since `-p` has no one to ask. Checks are run by the bridge instead. Agents are found on PATH when the bridge starts (`loadAgents()`); only Claude Code's login is checked (`claude auth status`, `checkClaude()`).

## Web app (web/)

- Vite, React, strict TypeScript. shadcn/ui and Tailwind for the chrome, plain CSS for the canvas.
- State lives in typed modules (`src/state`, `src/lib`). Each screen region (scene, sidebar and so on) re-renders when its render function runs. The camera writes the canvas transform directly, outside React.
- `src/api` holds typed wire types and a client for every bridge route, plus the long-poll loop.
- Model: `FILES`, `DIRMAP`, `RUNS`. `layout()` places folders as columns by depth (wider than tall), files as a grid of 420×300 boxes inside each folder frame. The layout in use (`S.LAYOUT`) is kept: known folders and files keep their places, new ones take free space. It is saved per repo (`saveLayoutSoon()` in `api/live.ts`) and loaded on connect, so a reload or another window size opens it as it was; "Tidy layout" lays it out afresh.
- `viewOf(file)` returns rows for the current mode (before, after, diff) using the run's `pre` and `hunks`.
- Semantic zoom: below 34% (`NEAR`) the canvas shows the tree with a tile per file, its name and change ticks, and no line texture: painting a texture per tile made panning drop frames on large repos; below 12% (`OVER`), tiles without names. Above 34%, code boxes with import lines.
- A session's edits are drawn as they land: each edit step's file against the file as the run found it (`lib/live.ts`), as a line diff.
- Demo mode uses a neutral sample repo (`src/demo`, a fictional webhook service). Live mode loads `/api/state` and polls events.

## Verified vs not

Verified with real Claude Code runs on scratch repos: selections that follow a rebase and a range that grows, the scope lock blocking an edit outside the selection with the hooks on and not blocking it with them off, and the prompt the agent receives. Every bridge route, watch mode, reverts, the hooks and the scope lock are covered by the end-to-end suites in `web/tests/e2e`, against the real bridge and stand-in agents.

Cursor: one real run recorded (2026-10-12), its reads and edits read as steps. Not yet verified with real runs: Codex output (tested against a stand-in that follows its published format).

## Known gaps

- A file renamed and moved to another folder that still has files takes a free slot there.
- File contents (first 400 lines each) are sent with `/api/state` for a map under 1,500 files (`LINES_UNDER`). A larger map carries each file's length alone, and the app asks for lines as it shows a file (`/api/heads`).
- Cursor and Codex are never held to their section.
- Cursor and Codex stream parsing is approximate.
