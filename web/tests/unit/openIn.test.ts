import { describe, expect, it } from 'vitest';
import { editorUrl } from '../../src/lib/openIn';

describe('editorUrl', () => {
  it('opens the file at the line in Cursor and VS Code', () => {
    expect(editorUrl('cursor', '/Users/me/app', 'src/main.py', 12)).toBe('cursor://file/Users/me/app/src/main.py:12');
    expect(editorUrl('vscode', '/Users/me/app', 'src/main.py', 1)).toBe('vscode://file/Users/me/app/src/main.py:1');
  });
  it('escapes spaces and other characters a URL cannot carry', () => {
    expect(editorUrl('cursor', '/Users/me/My Projects', 'app/(app)/page.tsx', 3)).toBe(
      'cursor://file/Users/me/My%20Projects/app/(app)/page.tsx:3',
    );
  });
});
