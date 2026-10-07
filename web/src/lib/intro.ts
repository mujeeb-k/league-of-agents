// The demo's introduction, and the page's description built from it. index.html carries the same words as plain
// HTML and in its meta tags; tests/unit/intro.test.ts keeps them identical.
export const TAGLINE = 'See every change your agents make.';
/** The privacy pair, word for word wherever it appears. */
export const PRIVACY =
  'League of Agents never uploads your code anywhere. Your code goes only to the agent you authorized.';
export const ABOUT =
  'League of Agents is a map of your repo for Claude Code, Codex and Cursor. Select files or lines, give your agent a task, then review its changes.';
/** The description after the tagline; each language's page translates it (i18n/pages.ts). */
export const SUMMARY =
  'A map of your repo for Claude Code, Codex and Cursor. Select files or lines, give your agent a task, then review its changes.';
export const DESCRIPTION = `${TAGLINE} ${SUMMARY}`;
/** What the social preview image shows, after the title written on it. */
export const IMAGE_ALT = "A map of a repository with an agent's changes marked.";
/** The privacy page's description, before the privacy pair. */
export const PRIVACY_ABOUT = 'What League of Agents collects.';
