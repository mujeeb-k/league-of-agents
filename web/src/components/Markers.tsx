// Where each session at work is: its file outlined in the session's colour, with what it is doing there (state/watch.ts).
// Its own region: a step moves these, and nothing else on the canvas.
import { CH, CW } from '../lib/constants';
import { S } from '../state/app';
import { useRegion } from '../state/render';
import { sessionColour } from '../state/sessions';
import { markers } from '../state/watch';
import { t } from '../i18n';

const doing = (act: string) =>
  act === 'read' ? t('Reading') : act === 'edit' ? t('Editing') : act === 'run' ? t('Running a command') : t('Working');

export function Markers() {
  useRegion('watch');
  useRegion('scene');
  return (
    <div id="markers">
      {markers().map(({ run, at, now }) => {
        const f = S.FILES.get(at.file!)!;
        return (
          <div
            key={run.id}
            className="marker"
            data-run={run.id}
            data-path={at.file}
            style={
              {
                width: `${CW}px`,
                height: `${CH}px`,
                transform: `translate(${f.x}px, ${f.y}px)`,
                '--zone': sessionColour(run),
              } as React.CSSProperties
            }
          >
            <b>{doing(now.act)}</b>
          </div>
        );
      })}
    </div>
  );
}
