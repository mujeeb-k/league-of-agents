// Revert conflict: files a run changed have changed again since. Live, the bridge
// can revert anyway; in the demo, the later run has to be reverted first.
import { TriangleAlert } from 'lucide-react';
import { forceRevert } from '../api/live';
import type { Conflict } from '../lib/types';
import { st } from '../state/app';
import { selectRun } from '../state/actions';
import { bump, useRegion } from '../state/render';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { t } from '../i18n';

let returnFocus: HTMLElement | null = null;
export function showConflict(c: Conflict | null) {
  if (c && !st.conflict) returnFocus = document.activeElement as HTMLElement | null;
  st.conflict = c;
  bump('dialog');
}

export function ConflictDialog() {
  useRegion('dialog');
  const c = st.conflict;
  return (
    <Dialog open={c !== null} onOpenChange={open => (open ? null : showConflict(null))}>
      <DialogContent
        id="conflictDlg"
        showCloseButton={false}
        onCloseAutoFocus={e => {
          // Opened by a revert, not by a trigger, so return focus to where the revert came from.
          e.preventDefault();
          if (returnFocus?.isConnected) returnFocus.focus();
        }}
        className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120"
      >
        {c ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <TriangleAlert className="size-4 text-mod" />
              <DialogTitle className="text-base">
                {c.later
                  ? t('Run {id} changed these files again', { id: c.later.id })
                  : t('These files changed after run {id}', { id: c.run.id })}
              </DialogTitle>
            </div>
            <DialogDescription className="mb-3 text-ink2 text-pretty">
              {c.later
                ? t('Reverting run {id} now would undo part of run {later}. Revert run {later} first, then run {id}.', {
                    id: c.run.id,
                    later: c.later.id,
                  })
                : t(
                    'Reverting run {id} puts these files back as they were before it, and the edits made since are lost.',
                    { id: c.run.id },
                  )}
            </DialogDescription>
            <ul
              id="conflictFiles"
              className="mb-6 flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 font-mono text-xs"
            >
              {c.files.map(f => (
                <li key={f} className="truncate" title={f}>
                  {f}
                </li>
              ))}
            </ul>
            <DialogFooter>
              {c.later ? (
                <>
                  <DialogClose asChild>
                    <Button variant="outline">{t('Close')}</Button>
                  </DialogClose>
                  <Button
                    onClick={() => {
                      const later = c.later!;
                      showConflict(null);
                      selectRun(later);
                    }}
                  >
                    {t('Open run {id}', { id: c.later.id })}
                  </Button>
                </>
              ) : (
                <>
                  <DialogClose asChild>
                    <Button variant="outline" id="conflictKeep">
                      {t('Keep my later edits')}
                    </Button>
                  </DialogClose>
                  {/* Destructive, but no red fill: warm colours stay small markers (BRAND.md). */}
                  <Button
                    variant="outline"
                    id="conflictRevert"
                    className="text-del hover:text-del"
                    onClick={() => {
                      showConflict(null);
                      void forceRevert(c.run);
                    }}
                  >
                    {t('Revert anyway')}
                  </Button>
                </>
              )}
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
