// Import lines on averroes-public's real imports (tests/fixtures/averroes-imports.json holds each
// file's import statements and its tsconfig.json, taken at 1c533f7). Expectations checked by hand.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { importResolver, type Repo } from '../../src/lib/imports';

const files = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../tests/fixtures/averroes-imports.json'), 'utf8'),
) as Record<string, string>;
const repo: Repo = { has: p => p in files, read: p => files[p] ?? null };
const resolve = importResolver(repo);
const importsOf = (p: string) => resolve(p, files[p]!.split('\n'));
const usersOf = (p: string) => Object.keys(files).filter(f => importsOf(f).includes(p));

describe('imports on averroes-public', () => {
  it('Python: absolute imports from the backend package, each to its module', () => {
    expect(importsOf('backend/app/routers/chat.py')).toEqual([
      'backend/app/config.py',
      'backend/app/middleware/auth.py',
      'backend/app/middleware/sanitize.py',
      'backend/app/models/schemas.py',
      'backend/app/prompts/assistant.py',
      'backend/app/repositories/conversation.py',
      'backend/app/services/llm.py',
    ]);
  });

  it('Python: `from package import module` links the package and each submodule', () => {
    expect(importsOf('backend/app/main.py')).toEqual([
      'backend/app/config.py',
      'backend/app/models/database.py',
      'backend/app/routers/__init__.py',
      'backend/app/routers/chat.py',
      'backend/app/routers/coach.py',
      'backend/app/routers/conversations.py',
      'backend/app/routers/spaces.py',
      'backend/app/routers/files.py',
    ]);
  });

  it('TS: @/ aliases from frontend/tsconfig.json, relative imports, and a multi-line import', () => {
    expect(importsOf('frontend/components/chat/chat-panel.tsx')).toEqual([
      'frontend/components/chat/welcome-screen.tsx',
      'frontend/components/chat/chat-input.tsx',
      'frontend/components/chat/message-bubble.tsx',
      'frontend/lib/api.ts',
      'frontend/lib/theme-context.tsx',
      'frontend/lib/commentator-context.tsx',
    ]);
    expect(importsOf('frontend/app/(app)/layout.tsx')).toEqual([
      'frontend/components/sidebar/sidebar.tsx',
      'frontend/components/commentator/commentator-panel.tsx',
      'frontend/lib/theme-context.tsx',
      'frontend/lib/commentator-context.tsx',
    ]);
  });

  it('used by: every module that imports app.config', () => {
    expect(usersOf('backend/app/config.py').sort()).toEqual(
      [
        'backend/app/main.py',
        'backend/app/models/database.py',
        'backend/app/routers/chat.py',
        'backend/app/routers/coach.py',
        'backend/app/routers/files.py',
        'backend/app/services/llm.py',
        'backend/app/middleware/rate_limit.py',
      ].sort(),
    );
  });

  it('packages, React and the standard library draw nothing; nothing throws', () => {
    for (const f of Object.keys(files)) expect(() => importsOf(f)).not.toThrow();
    expect(importsOf('frontend/app/layout.tsx')).toEqual([]);
  });
});

describe('import forms', () => {
  const mini = (fs: Record<string, string>) => {
    const r = importResolver({ has: p => p in fs, read: p => fs[p] ?? null });
    return (p: string) => r(p, fs[p]!.split('\n'));
  };
  it('Python relative imports count dots from the file’s own package', () => {
    const of = mini({
      'pkg/__init__.py': '',
      'pkg/a.py': 'from . import b\nfrom .sub import c\nfrom .. import top',
      'pkg/b.py': '',
      'pkg/sub/__init__.py': '',
      'pkg/sub/c.py': '',
      'top.py': '',
    });
    expect(of('pkg/a.py')).toEqual(['pkg/b.py', 'pkg/sub/__init__.py', 'pkg/sub/c.py', 'top.py']);
  });
  it('tsconfig with comments, trailing commas, baseUrl and extends', () => {
    const of = mini({
      'tsconfig.base.json': '{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["*"], }, }, } // base',
      'app/tsconfig.json': '{ /* app */ "extends": "../tsconfig.base.json" }',
      'app/main.ts': "import { x } from '~/util/x';\nimport y from 'react';",
      'src/util/x.ts': '',
    });
    expect(of('app/main.ts')).toEqual(['src/util/x.ts']);
  });
});
