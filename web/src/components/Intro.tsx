// What League of Agents is, for a visitor to the demo: the tagline as the page's one heading, two sentences and
// the install command. In the inspector on wide screens; under 860 px, a card at the top of the canvas that can be
// closed. index.html carries the same text as plain HTML for crawlers that don't run scripts (lib/intro).
import { X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { ABOUT, TAGLINE } from '../lib/intro';
import { S, st } from '../state/app';
import { bump, useRegion } from '../state/render';
import { CopyCommand } from './ConnectDialog';
import { Button } from './ui/button';
import { t } from '../i18n';

const NARROW = '(width < 860px)';
const subscribe = (fn: () => void) => {
  const m = matchMedia(NARROW);
  m.addEventListener('change', fn);
  return () => m.removeEventListener('change', fn);
};
const useNarrow = () => useSyncExternalStore(subscribe, () => matchMedia(NARROW).matches);

/** Only the demo introduces itself: a connected repository is the person's own. */
const shown = () => !!S.ROOT && !S.CONN;

function About() {
  return (
    <>
      <h1 id="introTitle" className="text-lg leading-snug font-semibold tracking-[-0.01em] text-balance">
        {TAGLINE}
      </h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink2 text-pretty">{t(ABOUT)}</p>
      <div className="mt-3">
        <CopyCommand ids={['introCommand', 'introCopy']} compact />
      </div>
    </>
  );
}

/** At the top of the inspector, on screens 860 px and wider. */
export function IntroSection() {
  const narrow = useNarrow();
  if (!shown() || narrow) return null;
  return (
    <section id="intro" className="border-b p-4">
      <About />
    </section>
  );
}

/** At the top of the canvas, under 860 px, until it is closed. */
export function IntroCard() {
  useRegion('inspector');
  const narrow = useNarrow();
  if (!shown() || !narrow || st.introClosed) return null;
  return (
    <section
      id="intro"
      className="absolute top-3 right-3 left-3 z-10 rounded-lg border bg-popover p-4 pr-10 shadow-[var(--e1)]"
    >
      <About />
      <Button
        variant="ghost"
        size="icon-sm"
        id="closeIntro"
        aria-label={t('Close')}
        className="absolute top-2 right-2"
        onClick={() => {
          st.introClosed = true;
          bump('inspector');
        }}
      >
        <X />
      </Button>
    </section>
  );
}
