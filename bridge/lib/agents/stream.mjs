// Claude Code, Cursor and Codex: each run is the agent's command line, with its stream of JSON events read as it works.
import path from 'node:path';
import { AGENTS } from './registry.mjs';
import { claudeLoggedOut } from './claude.mjs';
import { noteLines, noteWrites } from './lines.mjs';
import {
  refusedBySystem,
  refusedWrite,
  relPaths,
  repoRelative,
  toolError,
  toolLabel,
  toolSaid,
  toolText,
} from './labels.mjs';
import { launch } from './process.mjs';
import { shellAccess } from '../shell.mjs';
import { line } from '../util.mjs';
import { blocked, lockRefused, push, refusedBySandbox } from '../runs.mjs';
import { step, stepDone, stepRefused } from '../steps.mjs';
import { lockOfRun } from '../sandbox.mjs';
import { emit } from '../events.mjs';

/**
 * A connector for an agent run by its command line: `bin` names the command, `argsOf` its arguments for a prompt and,
 * for a follow-up, the session it resumes. The scope lock's file goes to the hooks through the environment.
 * @returns {import('./registry.mjs').Connector}
 */
export function streamConnector(bin, argsOf) {
  return {
    start(run, prompt, scopeFile) {
      const { child, closed } = launch(run, sandboxed => [bin(), ...argsOf(prompt, run, sandboxed)], {
        // A question asked of the person waits for them (hook.mjs askServer): no timeout of its own, unless the
        // person set one.
        env: () => ({
          LOA_SCOPE_FILE: scopeFile,
          ...shellAccess(run),
          ...(process.env.MCP_TOOL_TIMEOUT ? {} : { MCP_TOOL_TIMEOUT: String(24 * 3600 * 1000) }),
        }),
        onLine: line => {
          onAgentLine(run, line);
          // Nothing holds a session whose hook can't run: it stops there.
          if (run.unheld) child.kill('SIGTERM');
        },
        onStderr: d => {
          const t = d.trim();
          if (t) push(run, { t: 'err', text: t.slice(0, 500) });
        },
      });
      const done = closed.then(code => {
        forgetInputs(run);
        if (code && run.status === 'running')
          push(
            run,
            line('err', 'exited', `${AGENTS[run.agent].name} exited with code ${code}`, {
              agent: AGENTS[run.agent].name,
              code: String(code),
            }),
          );
        return code || run.unheld ? 'failed' : 'done';
      });
      return { cancel: () => child.kill('SIGTERM'), done };
    },
  };
}
/** Claude Code's tools that write a file they name. */
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit)$/;
/** What a Claude Code tool does, as a step (steps.mjs). */
const actOf = name => (EDIT_TOOLS.test(name) ? 'edit' : name === 'Read' ? 'read' : name === 'Bash' ? 'run' : 'other');
/**
 * Each run's tool calls so far, by the agent's id for the call: its step, what it does and the file it names, for its
 * result. Codex's file changes, one call for several files, have a step each.
 * @type {Map<number, Map<string, { i: number; act: string; file?: string }[]>>}
 */
const calls = new Map();
const callsOf = run => {
  if (!calls.has(run.id)) calls.set(run.id, new Map());
  return calls.get(run.id);
};
/** Each Claude Code tool call's run, name and input, by its id, until its result comes. */
const inputs = new Map();
/** A run's agent has exited: its calls that got no result never will. */
const forgetInputs = run => {
  for (const [id, c] of inputs) if (c.run === run.id) inputs.delete(id);
};
/**
 * A captured terminal turn keeps only the results that failed (hook.mjs lastTurn): its edit calls with none were
 * made, and what they put in is noted for its attribution.
 */
export function noteUnanswered(run) {
  for (const [id, c] of inputs)
    if (c.run === run.id) {
      noteWrites(run, c.name, c.input);
      inputs.delete(id);
    }
}
/** A tool call of the agent's, as a step for each file it names (or one with none). */
function called(run, id, act, tool, files) {
  const made = (files.length ? files : [undefined]).map(file => ({ i: step(run, act, tool, file), act, file }));
  if (id) callsOf(run).set(id, made);
}
const repoPath = f => repoRelative(f).split(path.sep).join('/');
/**
 * A Codex item as steps: a command it runs, or the files a change of its edits (Codex reads files by commands, so
 * reads aren't told apart). From Codex's own event types (exec_events.rs); no recorded run here yet.
 */
function codexStep(run, type, it) {
  const seen = callsOf(run).get(it.id);
  if (type === 'item.started' && it.type === 'command_execution') called(run, it.id, 'run', 'command', []);
  if (it.type !== 'file_change' || !Array.isArray(it.changes)) return;
  if (!seen)
    called(
      run,
      it.id,
      'edit',
      'file_change',
      it.changes.map(c => repoPath(String(c.path))),
    );
  if (type === 'item.completed' && it.status === 'completed')
    for (const c of callsOf(run).get(it.id) ?? []) stepDone(run, c.i);
}
/**
 * A Cursor tool call, started then completed: a line of the run's activity, and a step. A call is named by its kind
 * (readToolCall, editToolCall, grepToolCall, shellToolCall) with its args, as recorded runs have them
 * (tests/fixtures/agents/cursor); its docs also allow a `function` with a name. An edit's result is `success`, with
 * the file before and after it (Cursor 2026.10.16), or `error` when it wasn't made. The bridge's scope lock refused
 * it (cursor-refused-edit.jsonl): no edit, and the person is asked, as for Claude Code. Any other error (Cursor's own
 * "Invalid arguments", seen in a real run), or no result at all: no edit, and nothing to ask.
 */
function cursorStep(run, m) {
  const [kind, call] = Object.entries(m.tool_call ?? {})[0] ?? [];
  const name = kind === 'function' ? String(call?.name ?? kind) : String(kind).replace(/ToolCall$/, '');
  const file = typeof call?.args?.path === 'string' ? [repoPath(call.args.path)] : [];
  const act = /^read/.test(name)
    ? 'read'
    : /^(write|edit|delete)/.test(name)
      ? 'edit'
      : /^shell/.test(name)
        ? 'run'
        : 'other';
  if (m.subtype === 'started') {
    const label = toolLabel(name.charAt(0).toUpperCase() + name.slice(1), call?.args ?? {});
    push(run, { t: 'tool', text: label, ...toolSaid(act, file[0], call?.args?.command) });
    called(run, m.call_id, act, name, file);
  } else if (m.subtype === 'completed' && act === 'edit') {
    const result = call?.result ?? {};
    for (const c of callsOf(run).get(m.call_id) ?? [])
      if (/League of Agents scope lock/.test(String(result.error?.error ?? ''))) {
        stepRefused(run, c.i);
        if (c.file) blocked(run, c.file);
      } else if (result.success) {
        stepDone(run, c.i, {
          before: result.success.beforeFullFileContent,
          after: result.success.afterFullFileContent,
        });
        // The text it put in, as its call names it: what an edit whose start wasn't seen may be credited with.
        if (c.file && typeof call.args?.streamContent === 'string') noteLines(run, c.file, [call.args.streamContent]);
      }
  }
}
/** Said on a run whose hook couldn't run (registry.mjs held): nothing holds it, so it is stopped. */
const HOOK_FAILED = line(
  'err',
  'hook-failed',
  "The hook that holds this session couldn't run, so the session was stopped.",
);
/** One line of a Claude Code, Cursor or Codex stream (or a captured terminal turn's), read into the run. */
export function onAgentLine(run, line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    push(run, { t: 'text', text: line.slice(0, 500) });
    return;
  }
  if (m.session_id && !run.sessionId) run.sessionId = m.session_id;
  if (m.sessionId && !run.sessionId) run.sessionId = m.sessionId;
  if (m.type === 'thread.started' && m.thread_id && !run.sessionId) run.sessionId = m.thread_id;
  // The model, as the agent names it: Claude Code's and Cursor's first event, and each of Claude Code's replies.
  // Codex doesn't say. Claude Code marks its own made-up messages "<synthetic>".
  const model =
    m.type === 'system' && m.subtype === 'init' ? m.model : m.type === 'assistant' ? m.message?.model : null;
  if (typeof model === 'string' && model && !model.startsWith('<') && !run.model) run.model = model;
  // Logged out mid-session: Claude Code answers every prompt with "Not logged in".
  if (run.agent === 'claude' && m.type === 'assistant' && m.error === 'authentication_failed') claudeLoggedOut();
  if (m.type === 'assistant' && m.message?.content) {
    for (const c of m.message.content) {
      if (c.type === 'text' && c.text?.trim()) push(run, { t: 'text', text: c.text.trim() });
      if (c.type === 'tool_use') {
        const file = c.input?.file_path || c.input?.notebook_path;
        const act = actOf(c.name),
          at = typeof file === 'string' ? repoPath(file) : null;
        push(run, { t: 'tool', text: toolLabel(c.name, c.input), ...toolSaid(act, at, c.input?.command) });
        called(run, c.id, act, c.name, at ? [at] : []);
        // Noted once its result says it was made; a call with no id gets no result to wait for.
        if (c.id) inputs.set(c.id, { run: run.id, name: c.name, input: c.input });
        else noteWrites(run, c.name, c.input);
      }
    }
  } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
    const sandboxed = lockOfRun(run) === 'sandbox';
    for (const c of m.message.content) {
      if (c.type !== 'tool_result') continue;
      const text = toolText(c.content),
        [call] = callsOf(run).get(c.tool_use_id) ?? [];
      // A shell command the sandbox refused a write, failed or not (a command may carry on past it). Not a tool the
      // hook refused: that is no write, and is said as the hook worded it.
      if (call?.act !== 'edit' && sandboxed && refusedBySystem(text)) refusedBySandbox(run, text);
      // What its edit tool put in counts once its result says it was made (lines.mjs, the fallback).
      const made = inputs.get(c.tool_use_id);
      inputs.delete(c.tool_use_id);
      if (made && !c.is_error) noteWrites(run, made.name, made.input);
      if (call?.act === 'edit' && !c.is_error) stepDone(run, call.i);
      if (!c.is_error) continue;
      // Claude Code refused the call because the hook that holds the session couldn't run (registry.mjs held).
      if (sandboxed && /blocking because onFailure is "block"/.test(text) && !run.unheld) {
        run.unheld = true;
        push(run, { ...HOOK_FAILED });
        continue;
      }
      // An edit refused outside the section: the person is asked (runs.mjs blocked).
      if (call?.act === 'edit' && call.file && refusedWrite(text, sandboxed)) {
        stepRefused(run, call.i);
        blocked(run, call.file);
      } else {
        push(run, toolError(text));
        // A tool the hold refuses on a section, or a write it never lets one make (hook.mjs hold).
        if (/can't be used in a session on a section|is never changed by a session/.test(text)) lockRefused(run);
      }
    }
  } else if (m.type === 'system' && m.subtype === 'post_turn_summary') {
    // Claude Code's own verdict on the turn: completed or blocked, and what it needs from you. A later
    // turn's verdict replaces an earlier one.
    run.turn = {
      status: String(m.status_category || ''),
      detail: relPaths(String(m.status_detail || '')),
      needs: relPaths(String(m.needs_action || '')),
    };
    emit('progress', run);
  } else if (m.type === 'result') {
    if (typeof m.result === 'string') run.summary = m.result.trim();
    if (m.total_cost_usd != null) run.cost = m.total_cost_usd;
    emit('progress', run);
  } else if (m.type === 'tool_call') cursorStep(run, m);
  else if (m.type === 'item.completed' || m.type === 'item.started') {
    const it = m.item || m;
    push(run, { t: 'tool', text: it.type || it.name || m.type });
    if (it.text && m.type === 'item.completed' && /message/.test(it.type || '')) run.summary = it.text;
    codexStep(run, m.type, it);
  }
}
