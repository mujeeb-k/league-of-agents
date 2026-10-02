#!/usr/bin/env node
// Turns a raw agent recording (stream-json, one event per line) into a fixture that is safe to commit.
// Kept: event structure, types, tool names, ids, numbers, and paths. Everything else that could hold
// code or prose becomes a placeholder with its length. The repo root becomes /repo, home folders /home/user.
// Usage: node redact.mjs <raw.jsonl> <repo-root> > <fixture.jsonl>
import fs from 'node:fs';

const [file, root] = process.argv.slice(2);
if (!file || !root) {
  console.error('Usage: node redact.mjs <raw.jsonl> <repo-root>');
  process.exit(1);
}

/** Strings under these keys are identifiers, enums, or paths, never code or prose. */
const KEEP = new Set([
  'type',
  'subtype',
  'name',
  'tool_name',
  'id',
  'uuid',
  'session_id',
  'tool_use_id',
  'parent_tool_use_id',
  'model',
  'role',
  'stop_reason',
  'stop_sequence',
  'file_path',
  'notebook_path',
  'path',
  'cwd',
  'decision_reason_type',
  'status_category',
  'permissionMode',
  'apiKeySource',
  'output_style',
  'service_tier',
  'claude_code_version',
  'summarizes_uuid',
  'status',
  'rateLimitType',
  'overageStatus',
]);
/** Lists in the init event that describe the user's own setup. */
const ENVIRONMENT = new Set([
  'tools',
  'slash_commands',
  'terminal_slash_commands',
  'agents',
  'skills',
  'plugins',
  'mcp_servers',
  'capabilities',
]);
const SCOPE_LOCK = /League of Agents scope lock: \S+ is outside the selected scope\. Only edit: [^\n"]*/;

const paths = s =>
  s
    .split(root)
    .join('/repo')
    .replace(/\/Users\/[^/\s"']+/g, '/home/user');

/** A command keeps only the repo paths it mentions. */
const command = s => {
  const found = paths(s).match(/\/repo[^\s"';&|)]*/g) || [];
  return ['[command]', ...new Set(found)].join(' ');
};

function redact(value, key) {
  if (typeof value === 'string') {
    // An empty string carries no content, and "empty" is meaningful (for example, nothing needs action).
    if (value === '') return '';
    if (KEEP.has(key)) return paths(value);
    if (key === 'command') return command(value);
    const lock = value.match(SCOPE_LOCK);
    if (lock) return paths(lock[0]);
    if (/requires approval/.test(value))
      return `${value.slice(0, value.indexOf('requires approval') + 17)}: [${value.length} chars]`;
    return `[${value.length} chars]`;
  }
  if (Array.isArray(value)) {
    // The session's environment (tools, MCP servers, plugins, skills) is personal and not needed: count only.
    if (ENVIRONMENT.has(key)) return `[${value.length} items]`;
    return value.map(v => redact(v, key));
  }
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  process.stdout.write(JSON.stringify(redact(JSON.parse(line), '')) + '\n');
}
