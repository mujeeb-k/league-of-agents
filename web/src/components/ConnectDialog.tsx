// The connect screen: how to start the bridge, where its link goes, and what the browser will ask.
// Built on shadcn/ui; it is also the first-run screen.
import { Check, CircleAlert, Copy } from 'lucide-react';
import { useRef, useState } from 'react';
import { connect } from '../api/live';
import { parseConn } from '../api/conn';
import { dom, st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { cn } from '../lib/utils';
import { Spinner } from './bits';
import { Tip } from './TopBar';
import { Button } from './ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';

/** What a person types to start the bridge in their repo. */
export const RUN_COMMAND = 'npx leagueofagents-cli@latest';
/** The one line to paste into a coding agent: it reads setup.md and does the rest, asking first. */
export const SETUP_PROMPT = 'Read leagueofagents.dev/setup.md and set up League of Agents in this repo.';

export function setConnectOpen(open: boolean) {
  st.connectOpen = open;
  bump('dialog');
}

const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <li className="grid grid-cols-[24px_minmax(0,1fr)] gap-x-2">
    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-ink2 tabular-nums">
      {n}
    </span>
    <div className="min-w-0">
      <div className="flex h-6 items-center font-medium">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  </li>
);

/**
 * A line to copy, the command to start the bridge unless `text` says otherwise. `ids` names the code and the
 * button for tests; `compact` shows the button as an icon, for narrow places such as the inspector.
 */
export function CopyCommand({
  ids = ['runCommand', 'copyCommand'],
  compact = false,
  text = RUN_COMMAND,
  command = text === RUN_COMMAND,
}: {
  ids?: [string, string];
  compact?: boolean;
  text?: string;
  /** A shell command, in mono on one line; otherwise a sentence for an agent. */
  command?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const button = (
    <Button
      type="button"
      variant="ghost"
      size={compact ? 'icon-sm' : 'sm'}
      id={ids[1]}
      aria-label={copied ? 'Copied' : command ? 'Copy the command' : 'Copy the line'}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? <Check className="text-add" /> : <Copy />}
      {compact ? null : copied ? 'Copied' : 'Copy'}
    </Button>
  );
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted py-1 pr-1 pl-3">
      <code
        id={ids[0]}
        // A command reads in mono on one line; a sentence for an agent reads as text.
        className={cn(
          'min-w-0 flex-1',
          command ? 'font-mono text-xs whitespace-nowrap' : 'py-1 font-sans text-[13px] text-pretty',
        )}
      >
        {text}
      </code>
      {compact ? <Tip label={copied ? 'Copied' : 'Copy'}>{button}</Tip> : button}
    </div>
  );
}

export function ConnectDialog() {
  useRegion('dialog');
  useRegion('conn');
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = st.busy === 'connect';
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = parseConn(input.current!.value.trim());
    if (!c) {
      setError('Paste the full link the bridge printed. It starts with http://127.0.0.1.');
      return;
    }
    setError(null);
    // The dialog stays open while connecting, so a problem shows here, next to the link.
    const why = await connect(c, true);
    if (why) setError(why);
    else setConnectOpen(false);
  };
  return (
    <Dialog
      open={st.connectOpen}
      onOpenChange={open => {
        if (!open) setError(null);
        setConnectOpen(open);
      }}
    >
      <DialogContent
        id="connectDlg"
        showCloseButton={false}
        onOpenAutoFocus={e => {
          // Most people arrive with a link to paste; the field gets focus, not the copy button.
          e.preventDefault();
          input.current?.focus();
        }}
        onCloseAutoFocus={e => {
          // Opened from code, not from a trigger, so return focus to Connect ourselves.
          e.preventDefault();
          dom.connectBtn.focus();
        }}
        className="gap-0 rounded-2xl p-6 shadow-[var(--e2)] sm:max-w-120"
      >
        <DialogTitle className="mb-2 text-base">Connect your repo</DialogTitle>
        <DialogDescription className="mb-6 text-ink2 text-pretty">
          A small bridge runs on your machine, inside your repo, and never sends your code anywhere.{' '}
          <a
            id="privacyLink"
            href="https://leagueofagents.dev/privacy"
            target="_blank"
            rel="noopener"
            className="text-ink2 underline underline-offset-2 hover:text-foreground"
          >
            Privacy
          </a>
        </DialogDescription>
        <form onSubmit={e => void onSubmit(e)}>
          <ol className="flex flex-col gap-6">
            <Step n={1} title="Paste this into your coding agent">
              <CopyCommand ids={['setupPrompt', 'copySetup']} text={SETUP_PROMPT} />
              <p className="mt-3 mb-2 text-xs text-muted-foreground">Or run it yourself in your repo:</p>
              <CopyCommand />
              <p className="mt-2 text-xs text-muted-foreground">
                Requires macOS, Node 20 or later, and a git repo. Windows coming soon.
              </p>
            </Step>
            <Step n={2} title="It opens your repo in your browser. Or paste the link it prints">
              <Input
                id="connectInput"
                ref={input}
                aria-label="Bridge link"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? 'connectError' : undefined}
                placeholder="http://127.0.0.1:43210/#t=…"
                autoComplete="off"
                spellCheck="false"
                className="font-mono text-xs md:text-xs"
              />
              {error ? (
                <p id="connectError" role="alert" className="mt-2 flex gap-2 text-xs text-del">
                  <CircleAlert className="size-4 shrink-0" />
                  {error}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-muted-foreground text-pretty">
                Chrome and Edge will ask to let this site reach your computer: choose Allow. In other browsers, open the
                link the bridge prints instead.
              </p>
            </Step>
          </ol>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button variant="outline" id="connectCancel">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" id="connectGo" disabled={busy}>
              {busy ? <Spinner className="text-current" /> : null}
              {busy ? 'Connecting' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
