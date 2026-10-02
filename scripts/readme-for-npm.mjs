// The README links its images and files by relative path, so they show on GitHub while the repository is private.
// npm can't follow those, so packing rewrites them to full GitHub URLs (prepack) and puts the README back
// (postpack). Usage: node scripts/readme-for-npm.mjs pack|restore
import fs from 'node:fs';

const README = 'README.md',
  KEPT = '.README.repo.md';
const repo = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  .repository.url.replace(/^git\+/, '')
  .replace(/\.git$/, '')
  .replace('https://github.com/', '');
const IMAGE = /\.(png|gif|jpe?g|svg|webp)$/i;
const full = p => {
  if (/^([a-z]+:|#|\/)/i.test(p)) return p;
  return IMAGE.test(p)
    ? `https://raw.githubusercontent.com/${repo}/main/${p}`
    : `https://github.com/${repo}/blob/main/${p}`;
};

if (process.argv[2] === 'pack') {
  if (fs.existsSync(KEPT)) throw new Error(`${KEPT} is left from an earlier pack; restore it first.`);
  const text = fs.readFileSync(README, 'utf8');
  fs.writeFileSync(KEPT, text);
  fs.writeFileSync(
    README,
    text
      .replace(/(\]\()([^)\s]+)(\))/g, (_, a, p, b) => a + full(p) + b)
      .replace(/(src=")([^"]+)(")/g, (_, a, p, b) => a + full(p) + b),
  );
} else if (process.argv[2] === 'restore') {
  if (fs.existsSync(KEPT)) fs.renameSync(KEPT, README);
} else {
  console.error('Usage: node scripts/readme-for-npm.mjs pack|restore');
  process.exit(1);
}
