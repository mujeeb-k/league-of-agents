// What a check's command runs from the repo itself. A command such as `npm test` reads short, but it runs
// whatever the repo's package.json says, so the Checks panel says so before it's turned on.

/** The repo's own code a check's command runs, in words; null when the command is the whole story. */
export function runsRepoCode(command: string): string | null {
  // Found checks run in a folder first: `cd backend && npm test`.
  const parts = command.split('&&').map(s => s.trim());
  const dir = /^cd\s+'?([^']+?)'?$/.exec(parts.length > 1 ? parts[0]! : '')?.[1];
  const cmd = parts.at(-1)!;
  const where = dir ? `${dir}/package.json` : 'package.json';
  const script =
    /^(?:npm|pnpm|yarn)\s+(?:run\s+)?([\w:.-]+)/.exec(cmd)?.[1] ?? /^bun\s+run\s+([\w:.-]+)/.exec(cmd)?.[1];
  if (script) return `Runs the "${script}" script in this repo's ${where}.`;
  if (/^bun\s+test\b/.test(cmd)) return "Runs this repo's test files with Bun.";
  if (/\bpytest\b/.test(cmd)) return "Runs this repo's tests with pytest, and the conftest.py files they load.";
  return null;
}
