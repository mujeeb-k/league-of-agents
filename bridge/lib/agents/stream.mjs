// Claude Code, Cursor and Codex: each run is the agent's command line, with its stream of JSON events read as it works.
import { AGENTS } from './registry.mjs';
import { claudeLoggedOut } from './claude.mjs';
import { noteWrites } from './lines.mjs';
import { relPaths, toolError, toolLabel } from './labels.mjs';
import { launch } from './process.mjs';
import { push } from '../runs.mjs';
import { emit } from '../events.mjs';

/**
 * A connector for an agent run by its command line: `bin` names the command, `argsOf` its arguments for a prompt and,
 * for a follow-up, the session it resumes. The scope lock's file goes to the hooks through the environment.
 * @returns {import('./registry.mjs').Connector}
 */
export function streamConnector(bin, argsOf) {
  return {
    start(run, prompt, scopeFile) {
      const { child, closed } = launch(run, [bin(), ...argsOf(prompt, run)], {
        env: { LOA_SCOPE_FILE: scopeFile },
        onLine: line => onAgentLine(run, line),
        onStderr: d => {
          const t = d.trim();
          if (t) push(run, { t: 'err', text: t.slice(0, 500) });
        },
      });
      const done = closed.then(code => {
        if (code && run.status === 'running')
          push(run, { t: 'err', text: `${AGENTS[run.agent].name} exited with code ${code}` });
        return code ? 'failed' : 'done';
      });
      return { cancel: () => child.kill('SIGTERM'), done };
    },
  };
}
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
        push(run, { t: 'tool', text: toolLabel(c.name, c.input) });
        noteWrites(run, c.name, c.input);
      }
    }
  } else if (m.type === 'user' && Array.isArray(m.message?.content)) {
    for (const c of m.message.content) if (c.type === 'tool_result' && c.is_error) push(run, toolError(c.content));
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
  } else if (m.type === 'tool_call' || m.type === 'item.completed' || m.type === 'item.started') {
    const it = m.item || m.tool_call || m;
    push(run, { t: 'tool', text: it.type || it.name || m.type });
    if (it.text && m.type === 'item.completed' && /message/.test(it.type || '')) run.summary = it.text;
  }
}
