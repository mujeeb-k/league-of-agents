// What the canvas says when it has nothing to draw: connecting at startup, a bridge that doesn't answer, or a
// repository with no files.
// It sits in the part of the canvas the sidebar leaves free and never covers a drawn map.
import { FolderPlus, Laptop, Unplug } from 'lucide-react';
import { BLOCKED, UNREACHABLE } from '../api/errors';
import type { Conn } from '../api/types';
import { S, dom, st } from '../state/app';
import { loadDemo } from '../state/actions';
import { startConnect } from '../state/boot';
import { setConnUI, useRegion } from '../state/render';
import { Spinner, Translation } from './bits';
import { PRIVACY } from '../lib/intro';
import { CopyCommand } from './ConnectDialog';
import { Button } from './ui/button';
import { t } from '../i18n';

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div
      id="stageState"
      role="status"
      className="pointer-events-auto flex w-[min(420px,calc(100%-48px))] flex-col items-center gap-3 rounded-2xl border bg-popover p-6 text-center shadow-[var(--e1)]"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-muted text-ink2 [&_svg]:size-5">
        {icon}
      </span>
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {children}
    </div>
  );
}

/**
 * The bridge's own app, for when this page can't reach the bridge: with the link's code while it is unused, and
 * without a token otherwise (this browser's session token never goes in an address).
 */
const localLink = (conn: Conn) => (conn.fromLink ? `${conn.base}/#t=${conn.token}` : `${conn.base}/`);

function showDemo() {
  loadDemo();
  setConnUI();
  // The card goes away with the demo; keep focus somewhere useful once the prompt is enabled.
  requestAnimationFrame(() => dom.prompt.focus());
}

/**
 * The bridge a link pointed at didn't answer. Never a silent switch to the demo: the reason, the fix, and the
 * demo only when asked for. Either the bridge isn't running, or the browser kept the hosted page from reaching
 * this computer, which the bridge's own address avoids.
 */
function Unreachable({ conn, why }: { conn: Conn; why: string }) {
  const actions = (primary: React.ReactNode) => (
    <div className="flex flex-col items-center gap-1">
      <div className="flex gap-2">
        {primary}
        <Button variant="outline" size="sm" id="retryConnect" onClick={() => startConnect(conn)}>
          {t('Try again')}
        </Button>
      </div>
      <Button variant="ghost" size="sm" id="showDemo" className="text-ink2" onClick={showDemo}>
        {t('Show the demo instead')}
      </Button>
    </div>
  );
  if (why !== t(UNREACHABLE) && why !== BLOCKED)
    return (
      <Card icon={<Unplug />} title={t("Your bridge didn't accept this link")}>
        <p className="text-ink2 text-pretty">{why}</p>
        {actions(null)}
      </Card>
    );
  return (
    <Card icon={<Unplug />} title={t("Can't reach your bridge")}>
      {why === BLOCKED ? (
        <p id="blocked" className="text-ink2 text-pretty">
          {t(
            "This browser is set to keep {host} from reaching apps on your computer, so it can't reach the bridge. The local app needs no permission. To allow this site instead, click the icon left of the address, turn on access to apps on this device, and try again.",
            { host: location.host },
          )}
        </p>
      ) : (
        <>
          <p className="text-ink2 text-pretty">
            {t(
              'Nothing answered at {address}. The bridge may not be running, or this browser may be keeping the page from reaching your computer (in Chrome, the local network permission). The local app needs no permission.',
              { address: conn.base.replace(/^https?:\/\//, '') },
            )}
          </p>
          <div className="w-full text-left">
            <p className="mb-2 text-xs text-muted-foreground">
              {t("If the bridge isn't running, start it in your repo:")}
            </p>
            <CopyCommand ids={['unreachableCommand', 'unreachableCopy']} compact />
          </div>
        </>
      )}
      {actions(
        <Button asChild size="sm" id="localLink">
          <a href={localLink(conn)} className="no-underline">
            {t('Open the local app')}
          </a>
        </Button>,
      )}
    </Card>
  );
}

/**
 * Before the browser asks to let this site reach the computer: what it will ask, and to choose Allow. Nothing
 * reaches for the bridge until Continue, so the browser's question comes after this one.
 */
function AskAccess({ conn }: { conn: Conn }) {
  return (
    <Card icon={<Laptop />} title={t('Your browser will ask to connect')}>
      <p className="text-ink2 text-pretty">
        {t(
          'League of Agents runs on your computer, and this page connects to it there. Next, your browser asks to let {host} reach apps on this device. Choose Allow.',
          { host: location.host },
        )}
      </p>
      <p className="text-xs text-muted-foreground text-pretty">
        {PRIVACY}
        <Translation of={PRIVACY} className="mt-1" />
      </p>
      <div className="flex flex-col items-center gap-1">
        <Button size="sm" id="askContinue" onClick={() => startConnect(conn, true)}>
          {t('Continue')}
        </Button>
        <Button asChild variant="ghost" size="sm" id="askLocal" className="text-ink2">
          <a href={localLink(conn)} className="no-underline">
            {t('Open the local app instead')}
          </a>
        </Button>
      </div>
    </Card>
  );
}

export function StageState() {
  useRegion('conn');
  useRegion('scene');
  let card: React.ReactNode = null;
  if (st.asking && !S.ROOT) card = <AskAccess conn={st.asking} />;
  else if (st.starting && !S.ROOT)
    card = (
      <Card icon={<Spinner className="text-current" />} title={t('Connecting to your repo')}>
        <p className="text-ink2 text-pretty">
          {t(
            'Waiting for the bridge on this computer. If Chrome or Edge asks to let this site reach your computer, choose Allow.',
          )}
        </p>
        <Button variant="outline" size="sm" id="showDemo" onClick={showDemo}>
          {t('Show the demo meanwhile')}
        </Button>
      </Card>
    );
  else if (st.unreachable && !S.ROOT) card = <Unreachable {...st.unreachable} />;
  else if (S.CONN && S.ROOT && S.FILES.size === 0)
    card = (
      <Card icon={<FolderPlus />} title={t('This repository has no files yet')}>
        <p className="text-ink2 text-pretty">
          {t(
            'Add a file and commit it, or describe what to build in the prompt below. New files appear here as they are made.',
          )}
        </p>
      </Card>
    );
  if (!card) return null;
  return (
    <div
      data-inset=""
      className="pointer-events-none absolute inset-0 flex translate-x-[calc(var(--inset,0px)/2)] items-center justify-center pb-24"
    >
      {card}
    </div>
  );
}
