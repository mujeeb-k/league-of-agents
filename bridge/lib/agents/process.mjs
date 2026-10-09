// An agent's process: started in the repo, its output kept raw in .loa/runs/ and read line by line.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, RUNS_DIR } from '../repo.mjs';
import { push } from '../runs.mjs';
import { lockOfRun, sandboxArgs } from '../sandbox.mjs';

/**
 * Starts an agent for a run. Its stdout is kept as-is in .loa/runs/<id>.stream.jsonl (fixtures, debugging) and
 * handed to `onLine` a line at a time; its stderr is kept in <id>.stderr.log and handed to `onStderr`. `closed`
 * resolves with its exit code, once its logs are written.
 */
export function launch(run, argv, { env = {}, stdin = false, onLine, onStderr }) {
  // A session on a section runs inside the sandbox that holds it there (sandbox.mjs).
  const [cmd, ...args] = lockOfRun(run) === 'sandbox' ? [...sandboxArgs(run), ...argv] : argv;
  const child = spawn(cmd, args, {
    cwd: ROOT,
    env: { ...process.env, LOA_MANAGED: '1', ...env },
    stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });
  // A run's later turns (it carried on once allowed a file) add to its logs.
  const rawOut = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stream.jsonl`), { flags: 'a' });
  const rawErr = fs.createWriteStream(path.join(RUNS_DIR, `${run.id}.stderr.log`), { flags: 'a' });
  let buf = '';
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
  child.on('error', e => push(run, { t: 'err', text: `Could not start ${cmd}: ${e.message}` }));
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
