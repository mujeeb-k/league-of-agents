// A bridge older than this app asks to be updated. It still works: the banner only asks. It sits in the canvas's top-right corner, clear of
// the sidebar and of toasts, and can be closed for this connection. The canvas hint steps aside meanwhile.
import { TriangleAlert, X } from 'lucide-react';
import { useEffect } from 'react';
import { MIN_BRIDGE, olderThan } from '../lib/constants';
import { S, dom, st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { CopyCommand } from './ConnectDialog';
import { Button } from './ui/button';

export function UpdateBanner() {
  useRegion('conn');
  const shown = !!S.CONN && S.LIVE && !st.updateDismissed && olderThan(S.bridgeVersion, MIN_BRIDGE);
  // Set directly rather than with a :has() rule, which would be checked on every change to the canvas.
  useEffect(() => {
    dom.tip.hidden = shown;
  }, [shown]);
  if (!shown) return null;
  return (
    <div
      id="updateBanner"
      role="status"
      className="absolute top-3 right-3 z-10 flex w-[min(380px,calc(100%-24px))] gap-2 rounded-lg border border-l-2 border-l-mod bg-popover py-2.5 pr-2 pl-3 text-pretty shadow-[var(--e1)]"
    >
      <span className="flex h-5 shrink-0 items-center">
        <TriangleAlert className="size-4 text-mod" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p>
          <span className="font-semibold">Update your bridge.</span>{' '}
          <span className="text-ink2">
            {`It's ${S.bridgeVersion ? `version ${S.bridgeVersion}` : 'an older version'}. It still works; ${MIN_BRIDGE} or later has fixes. Stop it, then start the latest in your repo:`}
          </span>
        </p>
        <CopyCommand ids={['updateCommand', 'updateCopy']} compact />
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        id="closeUpdate"
        aria-label="Close"
        className="-mt-1"
        onClick={() => {
          st.updateDismissed = true;
          bump('conn');
        }}
      >
        <X />
      </Button>
    </div>
  );
}
