// Writing attribution to a git note, only when the person asks: what is written, where, and what git does with
// notes, before anything is written (bridge exportAttribution).
import { GitCommitHorizontal } from 'lucide-react';
import { exportAttribution } from '../api/live';
import { st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';

export type ExportFormat = 'agent-trace' | 'git-ai';
const WHAT: Record<ExportFormat, { name: string; ref: string }> = {
  'agent-trace': { name: 'an Agent Trace record', ref: 'refs/notes/agent-trace' },
  'git-ai': { name: 'a Git AI authorship log, with the lines agents wrote', ref: 'refs/notes/ai' },
};

export function showExport(format: ExportFormat | null) {
  st.exportFormat = format;
  bump('dialog');
}

export function ExportDialog() {
  useRegion('dialog');
  const f = st.exportFormat;
  return (
    <Dialog open={f !== null} onOpenChange={open => (open ? null : showExport(null))}>
      <DialogContent id="exportDlg" className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120">
        {f ? (
          <>
            <div className="mb-3 flex items-center gap-2">
              <GitCommitHorizontal className="size-4 text-ink2" />
              <DialogTitle className="text-base">Write attribution to a git note?</DialogTitle>
            </div>
            <DialogDescription className="text-ink2 text-pretty">
              {`Who wrote each line, for files unchanged since the last commit, as ${WHAT[f].name}, in ${WHAT[f].ref} on that commit. Your branch and staging area aren't touched, and no prompt is written.`}
            </DialogDescription>
            <p className="mt-3 mb-6 text-xs text-muted-foreground text-pretty">
              Git doesn't fetch or push notes unless you name them, and doesn't carry them through a rebase or an amend
              unless notes.rewriteRef is set.
            </p>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button
                id="exportWrite"
                onClick={() => {
                  showExport(null);
                  void exportAttribution(f);
                }}
              >
                Write the note
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
