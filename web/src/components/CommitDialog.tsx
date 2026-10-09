// Commit a run's files, after review: the message to edit, the files that go in, and any the person had changed
// before the run, left out unless ticked. The bridge commits only these (bridge/lib/commit.mjs), never on its own.
import { TriangleAlert } from 'lucide-react';
import { commitDraft, openCommit } from '../api/live';
import { st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';
import { Spinner } from './bits';
import { t } from '../i18n';

export function CommitDialog() {
  useRegion('dialog');
  const c = st.commit;
  const blocked = !c || c.changed.length > 0 || !c.branch || !c.message.trim() || st.busy === 'commit';
  return (
    <Dialog open={c !== null} onOpenChange={open => (open ? null : openCommit(null))}>
      <DialogContent id="commitDlg" className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120">
        {c ? (
          <>
            <DialogTitle className="mb-1 text-base">
              {c.branch
                ? t('Commit run {id} to {branch}', { id: c.run.id, branch: c.branch })
                : t('Commit run {id}', { id: c.run.id })}
            </DialogTitle>
            <DialogDescription className="mb-4 text-ink2 text-pretty">
              {t('Only these files go in. Nothing else you have staged or changed is touched, and nothing is pushed.')}
            </DialogDescription>
            <Textarea
              id="commitMessage"
              aria-label={t('Commit message')}
              value={c.message}
              rows={3}
              onChange={e => {
                c.message = e.target.value;
                bump('dialog');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !blocked) {
                  e.preventDefault();
                  void commitDraft();
                }
              }}
              className="mb-3 font-mono text-xs"
            />
            <ul id="commitFiles" className="mb-4 flex flex-col gap-1 rounded-lg border bg-card px-3 py-2 text-xs">
              {c.files.map(f => (
                <li key={f} className="truncate font-mono" title={f}>
                  {f}
                </li>
              ))}
              {c.yours.map(f => (
                <li key={f}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      data-include={f}
                      checked={c.include.has(f)}
                      onChange={e => {
                        if (e.target.checked) c.include.add(f);
                        else c.include.delete(f);
                        bump('dialog');
                      }}
                      className="mt-px size-3.5 shrink-0 cursor-pointer accent-[var(--sel)]"
                    />
                    <span className="min-w-0 truncate font-mono" title={f}>
                      {f}
                    </span>
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {t('Changed before this session, not committed')}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {c.changed.length ? (
              <p className="mb-4 flex gap-2 text-ink2 text-pretty">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-mod" />
                {t('{files} changed since the run. Review it again before committing.', {
                  files: c.changed.join(', '),
                })}
              </p>
            ) : !c.branch ? (
              <p className="mb-4 flex gap-2 text-ink2 text-pretty">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-mod" />
                {t('HEAD is detached. Check out a branch to commit to.')}
              </p>
            ) : null}
            {c.hookOutput ? (
              <div className="mb-4">
                <p className="mb-2 flex gap-2 text-ink2 text-pretty">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-mod" />
                  {t('Git refused the commit:')}
                </p>
                <pre
                  id="commitHookOutput"
                  className="max-h-40 overflow-auto rounded-lg border bg-card px-3 py-2 font-mono text-xs whitespace-pre-wrap"
                >
                  {c.hookOutput}
                </pre>
              </div>
            ) : null}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">{t('Cancel')}</Button>
              </DialogClose>
              <Button id="commitConfirm" disabled={blocked} onClick={() => void commitDraft()}>
                {st.busy === 'commit' ? <Spinner className="text-current" /> : null}
                {t('Commit')}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
