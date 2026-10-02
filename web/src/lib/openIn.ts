// Open a file at a line in another editor, through the editors' own URL schemes. Heavy editing
// belongs there; the map is for quick edits and agent work.
export const EDITORS = [
  { id: 'cursor', name: 'Cursor' },
  { id: 'vscode', name: 'VS Code' },
] as const;
export type EditorId = (typeof EDITORS)[number]['id'];

/** cursor://file/<absolute path>:<line>, and the same for vscode://. */
export const editorUrl = (id: EditorId, root: string, path: string, line: number) =>
  `${id}://file${encodeURI(`${root}/${path}`)}:${line}`;
