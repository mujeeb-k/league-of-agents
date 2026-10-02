// The example prompt a connected repo offers before its first run: built from a template for the one file or
// folder selected, with no model call, so it is instant and predictable.

/** An example prompt for the selection (keys as in st.sel: a path, or 'd:' and a folder), or null. */
export function examplePrompt(sel: string[]): string | null {
  if (sel.length !== 1) return null;
  const key = sel[0]!;
  if (key.startsWith('d:')) {
    const dir = key.slice(2);
    return dir
      ? `Add a short README.md to ${dir}/ that says what each file in it is for.`
      : 'Add a short section to the README that says what each top-level folder is for.';
  }
  const name = key.split('/').pop()!;
  if (/^test_|_test\.|\.(test|spec)\.[^.]+$/.test(name))
    return `Add one test to ${name} for a case it doesn't cover yet.`;
  if (/\.(md|mdx|rst|txt)$/i.test(name)) return `Fix typos and unclear sentences in ${name}. Keep the meaning.`;
  if (/\.(json|ya?ml|toml|lock|ini|cfg)$/i.test(name))
    return `Check ${name} for unused or inconsistent entries and fix them.`;
  return `Add a short comment at the top of ${name} that says what the file is for.`;
}
