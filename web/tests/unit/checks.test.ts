import { describe, expect, it } from 'vitest';
import { runsRepoCode } from '../../src/lib/checks';

describe('runsRepoCode', () => {
  it("names the repo's own script a package manager runs, in its folder", () => {
    expect(runsRepoCode('npm test')).toBe(`Runs the "test" script in this repo's package.json.`);
    expect(runsRepoCode('pnpm run typecheck')).toBe(`Runs the "typecheck" script in this repo's package.json.`);
    expect(runsRepoCode("cd 'web app' && yarn test")).toBe(
      `Runs the "test" script in this repo's web app/package.json.`,
    );
    expect(runsRepoCode('bun run lint')).toBe(`Runs the "lint" script in this repo's package.json.`);
  });
  it("says when a test runner runs the repo's own test code", () => {
    expect(runsRepoCode('bun test')).toBe("Runs this repo's test files with Bun.");
    expect(runsRepoCode('cd backend && python3 -m pytest -q')).toBe(
      "Runs this repo's tests with pytest, and the conftest.py files they load.",
    );
  });
  it('adds nothing for a command that is its whole story', () => {
    expect(runsRepoCode('node -e "console.log(1)"')).toBeNull();
    expect(runsRepoCode('echo ok')).toBeNull();
  });
});
