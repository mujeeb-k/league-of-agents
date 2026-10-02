// File-type icons, shared by the explorer and the canvas. Each Lucide icon is drawn once as a <symbol>,
// and every row points at it with <use>, so even 1,000 rows stay cheap.
import {
  File,
  FileBraces,
  FileCode,
  FileCog,
  FileImage,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';
import type { FileKind } from '../lib/fileKind';

const ICONS: Record<FileKind | 'folder' | 'folder-open', LucideIcon> = {
  folder: Folder,
  'folder-open': FolderOpen,
  code: FileCode,
  shell: FileTerminal,
  json: FileBraces,
  config: FileCog,
  text: FileText,
  image: FileImage,
  table: FileSpreadsheet,
  lock: FileLock,
  file: File,
};

/** Rendered once, hidden; FileIcon refers to its symbols. */
export function IconSprite() {
  return (
    <svg aria-hidden="true" className="absolute size-0 overflow-hidden">
      {Object.entries(ICONS).map(([kind, Icon]) => (
        <symbol key={kind} id={'ic-' + kind} viewBox="0 0 24 24">
          <Icon />
        </symbol>
      ))}
    </svg>
  );
}

export const FileIcon = ({ kind }: { kind: keyof typeof ICONS }) => (
  <svg aria-hidden="true" className="ic">
    <use href={'#ic-' + kind} />
  </svg>
);
