// The example prompt a connected repo offers before its first run: built from a template for the one file or
// folder selected, with no model call, so it is instant and predictable.
import { t } from '../i18n';

/** An example prompt for the selection (keys as in st.sel: a path, or 'd:' and a folder), or null. */
export function examplePrompt(sel: string[]): string | null {
  if (sel.length !== 1) return null;
  const key = sel[0]!;
  if (key.startsWith('d:')) {
    const dir = key.slice(2);
    return dir
      ? t('Add a short README.md to {dir}/ that says what each file in it is for.', { dir })
      : t('Add a short section to the README that says what each top-level folder is for.');
  }
  const name = key.split('/').pop()!;
  if (/^test_|_test\.|\.(test|spec)\.[^.]+$/.test(name))
    return t("Add one test to {name} for a case it doesn't cover yet.", { name });
  if (/\.(md|mdx|rst|txt)$/i.test(name))
    return t('Fix typos and unclear sentences in {name}. Keep the meaning.', { name });
  if (/\.(json|ya?ml|toml|lock|ini|cfg)$/i.test(name))
    return t('Check {name} for unused or inconsistent entries and fix them.', { name });
  return t('Add a short comment at the top of {name} that says what the file is for.', { name });
}
