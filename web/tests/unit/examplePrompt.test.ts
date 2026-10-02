import { describe, expect, it } from 'vitest';
import { examplePrompt } from '../../src/lib/examplePrompt';

describe('examplePrompt (the first-run example)', () => {
  it('needs exactly one file or folder', () => {
    expect(examplePrompt([])).toBeNull();
    expect(examplePrompt(['a.ts', 'b.ts'])).toBeNull();
  });
  it('fits the kind of file', () => {
    expect(examplePrompt(['src/app/main.py'])).toBe(
      'Add a short comment at the top of main.py that says what the file is for.',
    );
    expect(examplePrompt(['backend/tests/test_coach.py'])).toBe(
      "Add one test to test_coach.py for a case it doesn't cover yet.",
    );
    expect(examplePrompt(['web/src/util.test.ts'])).toBe(
      "Add one test to util.test.ts for a case it doesn't cover yet.",
    );
    expect(examplePrompt(['docs/GUIDE.md'])).toBe('Fix typos and unclear sentences in GUIDE.md. Keep the meaning.');
    expect(examplePrompt(['package.json'])).toBe('Check package.json for unused or inconsistent entries and fix them.');
  });
  it('offers a README for a folder, or a section for the whole repo', () => {
    expect(examplePrompt(['d:backend/app'])).toBe(
      'Add a short README.md to backend/app/ that says what each file in it is for.',
    );
    expect(examplePrompt(['d:'])).toBe(
      'Add a short section to the README that says what each top-level folder is for.',
    );
  });
});
