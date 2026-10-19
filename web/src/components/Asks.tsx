// What a session asks of the person, with Allow and Refuse: on its card in the sidebar, and in the inspector, which is
// what a phone shows of a run.
import type { Run } from '../lib/types';
import { answerWant } from '../api/live';
import { isOffline } from '../state/actions';
import { st } from '../state/app';
import { asking, holderOf, wantSaid } from '../state/sessions';
import { Button } from './ui/button';
import { t } from '../i18n';

/**
 * What a session asks of the person, each with Allow and Refuse: a write it was refused outside its section (Allow
 * adds the file to the section and the session carries on; Refuse keeps it out; a file another session's section
 * holds waits for that one to end), or what its agent asked permission for, as it would in a terminal.
 */
export function Asks({ r }: { r: Run }) {
  return asking(r).map(w => {
    const holder = w.ask ? null : holderOf(r, w.path);
    return (
      <div
        key={w.ask ?? w.path}
        {...(w.ask ? { 'data-ask': w.ask } : { 'data-want': w.path })}
        className="mt-2 rounded-lg border bg-card px-2.5 py-2 text-xs"
      >
        <p className="text-foreground text-pretty [overflow-wrap:anywhere]">{wantSaid(w)}</p>
        {holder ? (
          <p className="held mt-0.5 text-muted-foreground text-pretty">
            {t('Run {id} is working on it.', { id: holder.id })}
          </p>
        ) : null}
        <div className="mt-2 flex gap-1.5">
          <Button
            size="xs"
            data-allow
            disabled={!!holder || !!st.busy || isOffline()}
            onClick={() => void answerWant(r, w, true)}
          >
            {t('Allow')}
          </Button>
          <Button
            size="xs"
            variant="outline"
            data-refuse
            disabled={!!st.busy || isOffline()}
            onClick={() => void answerWant(r, w, false)}
          >
            {t('Refuse')}
          </Button>
        </div>
      </div>
    );
  });
}
