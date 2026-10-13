// Revert a run that has files another session edited too: the run's own files go back, and each shared file only
// when ticked. A run with no shared file reverts at once, with no dialog (api/live.ts liveAction).
import { openRevert, revertChosen } from '../api/live';
import { ownFiles, sharedOf } from '../lib/model';
import { cn } from '../lib/utils';
import { S, st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { SharedTag } from './bits';
import { t } from '../i18n';

let returnFocus: HTMLElement | null = null;

export function RevertDialog() {
  useRegion('dialog');
  // Drawn again as sessions start and end: a shared file's box is off while its other session works.
  useRegion('side');
  const r = st.revert;
  const own = r ? ownFiles(r.run) : [],
    n = own.length + (r?.include.size ?? 0);
  return (
    <Dialog open={r !== null} onOpenChange={open => (open ? null : openRevert(null))}>
      <DialogContent
        id="revertDlg"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          returnFocus = document.activeElement as HTMLElement | null;
        }}
        onCloseAutoFocus={e => {
          // Opened by the run's Revert button, not by a trigger, so focus returns there.
          e.preventDefault();
          (returnFocus?.isConnected
            ? returnFocus
            : document.querySelector<HTMLElement>('#insp [data-act="revert"]')
          )?.focus();
        }}
        className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120"
      >
        {r ? (
          <>
            <DialogTitle className="mb-1 text-base">{t('Revert run {id}?', { id: r.run.id })}</DialogTitle>
            <DialogDescription className="mb-4 text-ink2 text-pretty">
              {t('Puts these files back as they were before run {id}. Nothing else is touched.', { id: r.run.id })}
            </DialogDescription>
            <ul id="revertFiles" className="mb-6 flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-xs">
              {own.map(f => (
                <li key={f} className="truncate font-mono" title={f}>
                  {f}
                </li>
              ))}
              {[...sharedOf(r.run)].map(([f, runs]) => {
                // While the other session still works on it, the file can't go back: its edits aren't all in yet.
                const busy = runs.find(id => S.WORKING.includes(id));
                return (
                  <li key={f}>
                    <label className={cn('flex items-start gap-2', !busy && 'cursor-pointer')}>
                      <input
                        type="checkbox"
                        data-include={f}
                        disabled={busy !== undefined}
                        checked={r.include.has(f)}
                        onChange={e => {
                          if (e.target.checked) r.include.add(f);
                          else r.include.delete(f);
                          bump('dialog');
                        }}
                        className="mt-px size-3.5 shrink-0 cursor-pointer accent-[var(--sel)] disabled:cursor-default"
                      />
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={cn('min-w-0 truncate font-mono', busy && 'text-muted-foreground')} title={f}>
                            {f}
                          </span>
                          <SharedTag runs={runs} />
                        </span>
                        <span className="mt-0.5 block text-muted-foreground text-pretty">
                          {busy
                            ? t('Run {id} is still working. Choose once it ends.', { id: busy })
                            : t(
                                'Ticked, it goes back as run {id} found it. What the other session changed in it since is lost.',
                                { id: r.run.id },
                              )}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t('Cancel')}</Button>
              </DialogClose>
              {/* Destructive, but no red fill: warm colours stay small markers (BRAND.md). */}
              <Button
                variant="outline"
                id="revertConfirm"
                disabled={!n}
                className="text-del tabular-nums hover:text-del"
                onClick={() => void revertChosen()}
              >
                {t('Revert')}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
