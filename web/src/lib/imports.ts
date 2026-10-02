// Which files a file imports: relative JS and TS imports, path
// aliases from tsconfig.json or jsconfig.json, and Python imports, absolute and relative. An import that
// doesn't resolve to a file in the repo draws nothing.

/** What the resolver can see: whether a path is a file in the repo, and a config file's text. */
export interface Repo {
  has(path: string): boolean;
  read(path: string): string | null;
}

export function joinPath(dir: string, spec: string) {
  const parts = dir ? dir.split('/') : [];
  for (const seg of spec.split('/')) {
    if (seg === '.' || !seg) continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/** A JS or TS module path to a file: as written, with an extension, or as a folder's index. */
function scriptFile(repo: Repo, base: string): string | null {
  const noJs = base.replace(/\.(m?js|jsx)$/, '');
  for (const c of [
    base,
    noJs + '.ts',
    noJs + '.tsx',
    noJs + '.js',
    noJs + '.jsx',
    noJs + '.mjs',
    base + '/index.ts',
    base + '/index.tsx',
    base + '/index.js',
  ])
    if (repo.has(c)) return c;
  return null;
}

// ---------------------------------------------------------------- tsconfig paths

interface Aliases {
  /** The folder the patterns resolve from: the config's folder plus its baseUrl. */
  base: string;
  paths: [pattern: string, targets: string[]][];
}

/** JSON with the comments and trailing commas tsconfig allows. */
function looseJson(text: string): unknown {
  const noComments = text.replace(
    /\/\*[\s\S]*?\*\/|("(?:[^"\\]|\\.)*")|\/\/.*$/gm,
    (_, str: string | undefined) => str ?? '',
  );
  try {
    return JSON.parse(noComments.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

type Config = { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };

/** A config's aliases, following a relative `extends` chain; the nearer config's settings win. */
function aliasesOf(repo: Repo, path: string, depth = 0): Aliases | null {
  const text = repo.read(path);
  const c = text === null ? null : (looseJson(text) as Config | null);
  if (!c || typeof c !== 'object') return null;
  const dir = dirOf(path);
  const parent =
    depth < 5 && typeof c.extends === 'string' && c.extends.startsWith('.')
      ? aliasesOf(repo, joinPath(dir, c.extends.endsWith('.json') ? c.extends : c.extends + '.json'), depth + 1)
      : null;
  const opts = c.compilerOptions ?? {};
  const paths =
    opts.paths && typeof opts.paths === 'object'
      ? Object.entries(opts.paths as Record<string, unknown>).map(
          ([k, v]) =>
            [k, Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []] as [string, string[]],
        )
      : null;
  const base = typeof opts.baseUrl === 'string' ? joinPath(dir, opts.baseUrl) : (parent?.base ?? dir);
  if (!paths && !parent) return null;
  return { base, paths: paths ?? parent!.paths };
}

/** The config that governs a file: the nearest tsconfig.json or jsconfig.json in its folder or above. */
function configFor(repo: Repo, file: string, cache: Map<string, Aliases | null>): Aliases | null {
  for (let dir = dirOf(file); ; dir = dirOf(dir)) {
    if (!cache.has(dir)) {
      const at = (n: string) => (dir ? `${dir}/${n}` : n);
      const found = repo.has(at('tsconfig.json'))
        ? at('tsconfig.json')
        : repo.has(at('jsconfig.json'))
          ? at('jsconfig.json')
          : null;
      cache.set(dir, found ? aliasesOf(repo, found) : null);
    }
    const a = cache.get(dir);
    if (a) return a;
    if (!dir) return null;
  }
}

function resolveAlias(repo: Repo, a: Aliases, spec: string): string | null {
  for (const [pattern, targets] of a.paths) {
    const star = pattern.indexOf('*');
    const prefix = star < 0 ? pattern : pattern.slice(0, star),
      suffix = star < 0 ? '' : pattern.slice(star + 1);
    if (star < 0 ? spec !== pattern : !spec.startsWith(prefix) || !spec.endsWith(suffix)) continue;
    const rest = star < 0 ? '' : spec.slice(prefix.length, spec.length - suffix.length);
    for (const t of targets) {
      const hit = scriptFile(repo, joinPath(a.base, t.replace('*', rest)));
      if (hit) return hit;
    }
  }
  return null;
}

// ---------------------------------------------------------------- Python

/** A dotted module (a.b.c) under a folder, as a module file or a package's __init__.py. */
function pythonModule(repo: Repo, dir: string, dotted: string): string | null {
  const base = joinPath(dir, dotted.split('.').join('/'));
  for (const c of [base + '.py', base + '/__init__.py']) if (repo.has(c)) return c;
  return null;
}

/**
 * Python imports. Absolute ones are looked for from the importing file's folder up to the repo root, so a
 * package under a source folder (backend/app) resolves. `from pkg import name` also links pkg/name.py when
 * that is a submodule. Relative imports count leading dots from the file's own package.
 */
function pythonImports(repo: Repo, file: string, text: string): string[] {
  const out: string[] = [];
  const absolute = (dotted: string) => {
    for (let dir = dirOf(file); ; dir = dirOf(dir)) {
      const hit = pythonModule(repo, dir, dotted);
      if (hit) return { hit, dir };
      if (!dir) return null;
    }
  };
  for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*)([\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
    const [, dots, mod, names] = m as unknown as [string, string, string, string];
    const imported = names
      .replace(/[()]/g, ' ')
      .split(',')
      .map(n => n.trim().split(/\s+as\s+/)[0]!)
      .filter(n => /^\w+$/.test(n));
    let dir: string, hit: string | null;
    if (dots) {
      dir = dirOf(file);
      for (let i = 1; i < dots.length; i++) dir = dirOf(dir);
      hit = mod ? pythonModule(repo, dir, mod) : null;
      if (mod) dir = joinPath(dir, mod.split('.').join('/'));
    } else {
      const found = absolute(mod);
      if (!found) continue;
      hit = found.hit;
      dir = joinPath(found.dir, mod.split('.').join('/'));
    }
    if (hit) out.push(hit);
    for (const n of imported) {
      const sub = pythonModule(repo, dir, n);
      if (sub) out.push(sub);
    }
  }
  for (const m of text.matchAll(
    /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm,
  ))
    for (const part of m[1]!.split(',')) {
      const found = absolute(part.trim().split(/\s+as\s+/)[0]!);
      if (found) out.push(found.hit);
    }
  return out;
}

// ---------------------------------------------------------------- all files

const SCRIPT = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

/** Makes a resolver for one repo; config files are read once. */
export function importResolver(repo: Repo) {
  const configs = new Map<string, Aliases | null>();
  /** The repo files a file imports, in order, each once, never itself. */
  return (file: string, lines: string[]): string[] => {
    const text = lines.join('\n');
    const found: string[] = [];
    if (file.endsWith('.py')) found.push(...pythonImports(repo, file, text));
    else
      for (const m of text.matchAll(SCRIPT)) {
        const spec = m[1]!;
        if (spec.startsWith('.')) {
          const hit = scriptFile(repo, joinPath(dirOf(file), spec));
          if (hit) found.push(hit);
        } else {
          const a = configFor(repo, file, configs);
          const hit = a && resolveAlias(repo, a, spec);
          if (hit) found.push(hit);
        }
      }
    return [...new Set(found)].filter(p => p !== file);
  };
}
