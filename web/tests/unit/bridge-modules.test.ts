// The bridge's modules load without doing anything: an agent's hook loads them on every tool call, and modules that
// import each other must not run code that needs one not yet loaded. Only the command modules act when loaded.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const LIB = path.join(__dirname, '../../../bridge/lib');
/** Modules that are commands: loading one runs it. */
const COMMANDS = ['main.mjs'];

describe('the bridge modules', () => {
  const modules = fs.readdirSync(LIB).filter(f => f.endsWith('.mjs') && !COMMANDS.includes(f));
  it.each(modules)('%s loads without output, errors or files written', file => {
    // Outside any git repo, where code that sets the bridge up would fail loudly.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loa-load-'));
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(path.join(LIB, file)).href)})`],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(out).toBe('');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
