// The kind of a file, for its icon in the explorer and on the canvas.
export type FileKind = 'code' | 'shell' | 'json' | 'config' | 'text' | 'image' | 'table' | 'lock' | 'file';

const BY_EXT: Record<string, FileKind> = {};
const add = (kind: FileKind, exts: string) => exts.split(' ').forEach(e => (BY_EXT[e] = kind));
add(
  'code',
  'ts tsx js jsx mjs cjs mts cts py pyi go rs rb java kt kts swift c h cc cpp hpp cs php vue svelte astro scala lua dart ex exs erl hs ml clj sql css scss sass less html htm graphql gql proto',
);
add('shell', 'sh bash zsh fish ps1 bat cmd');
add('json', 'json jsonc json5');
add('config', 'yml yaml toml ini cfg conf env properties xml plist');
add('text', 'md mdx txt rst adoc');
add('image', 'png jpg jpeg gif svg webp ico avif bmp');
add('table', 'csv tsv xlsx xls');
add('lock', 'lock');

const BY_NAME: Record<string, FileKind> = {
  'package-lock.json': 'lock',
  'yarn.lock': 'lock',
  'pnpm-lock.yaml': 'lock',
  'bun.lockb': 'lock',
  dockerfile: 'config',
  makefile: 'config',
  license: 'text',
};

export function fileKind(name: string): FileKind {
  const lower = name.toLowerCase();
  if (BY_NAME[lower]) return BY_NAME[lower];
  if (lower.startsWith('.env')) return 'config';
  const dot = lower.lastIndexOf('.');
  if (dot === 0) return 'config';
  return (dot > 0 && BY_EXT[lower.slice(dot + 1)]) || 'file';
}
