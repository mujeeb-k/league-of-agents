// Which folder of the repository the map is of: asked when the repository has more code files than a map shows, and
// changed from the crumb or the command menu. The bridge remembers the choice (GET /api/state?root=).
import { useState } from 'react';
import { mapFolder, openMapPicker } from '../api/live';
import { S, st } from '../state/app';
import { useRegion } from '../state/render';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { t, tn } from '../i18n';

/** Folders listed at most, the closest to the top first: typing narrows them. */
const SHOWN = 200;

export function MapPicker() {
  useRegion('dialog');
  return (
    <Dialog open={st.mapPicker} onOpenChange={open => openMapPicker(open)}>
      {st.mapPicker ? <Picker /> : null}
    </Dialog>
  );
}

/** The picker's content, made afresh each time it opens, its filter empty. */
function Picker() {
  const [filter, setFilter] = useState('');
  const folders = st.folders;
  const q = filter.trim().toLowerCase();
  const shown = (folders ?? [])
    .filter(f => !q || f.path.toLowerCase().includes(q))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))
    .slice(0, SHOWN);
  return (
    <DialogContent id="mapPicker" className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120">
      <DialogTitle className="mb-1 text-base">{t('Map a folder')}</DialogTitle>
      <DialogDescription className="mb-4 text-ink2 text-pretty">
        {S.codeFiles > (S.mapMax || Infinity)
          ? t('{repo} has {n} code files. A map shows up to {max}: pick a folder.', {
              repo: S.repoName,
              n: S.codeFiles.toLocaleString(),
              max: S.mapMax.toLocaleString(),
            })
          : t('Pick the folder the map shows.')}
      </DialogDescription>
      <Input
        aria-label={t('Find a folder')}
        placeholder={t('Find a folder')}
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="mb-3"
      />
      <ul className="flex max-h-80 flex-col overflow-y-auto rounded-lg border bg-card py-1 text-sm">
        {folders === null ? <li className="px-3 py-1.5 text-muted-foreground">{t('Loading…')}</li> : null}
        {shown.map(f => (
          <li key={f.path}>
            <button
              type="button"
              data-folder={f.path}
              onClick={() => void mapFolder(f.path)}
              className={cn(
                'flex w-full items-center gap-3 px-3 py-1.5 text-left outline-none hover:bg-accent/60',
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset',
                f.path === S.mapRoot && 'bg-sel-soft',
              )}
            >
              <span className={cn('min-w-0 flex-1 truncate', f.path && 'font-mono text-xs')} title={f.path}>
                {f.path || t('Whole repository')}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {tn(f.files, '{n} file', '{n} files')}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}
