// An agent's process: started in the repo, its output kept raw in .loa/runs/ and read line by line.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, RUNS_DIR } from '../repo.mjs';
import { line } from '../util.mjs';
import { push } from '../runs.mjs';
import { lockOfRun, sandboxArgs } from '../sandbox.mjs';

/**
 * Starts an agent for a run. `argv` and `env` are told whether it starts inside the sandbox, here and nowhere else:
 * what an agent is allowed only there (running without its own permission check) can't reach one started outside it.
 * Its stdout is kept as-is in .loa/runs/<id>.stream.jsonl (fixtures, debugging) and
 * handed to `onLine` a line at a time; its stderr is kept in <id>.stderr.log and handed to `onStderr`. `closed`
 * resolves with its exit code, once its logs are written.
 */
export function launch(
  run,
  argv,
  { env = /** @type {(sandboxed: boolean) => Record<string, string>} */ (() => ({})), stdin = false, onLine, onStderr },
) {
  // A session on a section runs inside the sandbox that holds it there (sandbox.mjs).
  const sandboxed = lockOfRun(run) === 'sandbox';
  const [cmd, ...args] = sandboxed ? [...sandboxArgs(run), ...argv(true)] : argv(false);
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', ...env(sandboxed) },
    stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  // A run's later turns (it carried on once allowed a file) add to its logs.
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`), { flags: 'a' });
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`), { flags: 'a' });
  let buf = '';
  // Decoded as UTF-8 across chunks: a character split between two keeps its bytes together.
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', d => {
    rawOut.write(d);
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(line);
    }
  });
  child.stderr.on('data', d => {
    rawErr.write(d);
    onStderr(String(d));
  });
  child.on('error', e =>
    push(run, line('err', 'not-launched', `Could not start ${cmd}: ${e.message}`, { command: cmd, why: e.message })),
  );
  /** @type {Promise<number | null>} */
  const closed = new Promise(resolve =>
    child.on('close', code => {
      rawOut.end();
      rawErr.end();
      resolve(code);
    }),
  );
  return { child, closed };
}
