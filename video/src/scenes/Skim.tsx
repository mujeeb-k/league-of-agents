// A real Claude Code session finishing a long task: its last steps, then its summary, scrolling past in the
// terminal faster than anyone reads it.
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { C, MONO, SHADOW } from '../brand';
import { useSession } from '../data';
import { BOX, Stacked } from '../ui';

const ROW = 44;
const COLS = 84;
/** A terminal's own wrapping: long lines break at the window's width, indented under their bullet. */
const wrap = (text: string) => {
  const out: string[] = [];
  let rest = text;
  while (rest.length > COLS) {
    const cut = rest.lastIndexOf(' ', COLS);
    const at = cut > 20 ? cut : COLS;
    out.push(rest.slice(0, at));
    rest = '  ' + rest.slice(at).trimStart();
  }
  return [...out, rest];
};

export const Skim: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const s = useSession('skim-session.jsonl');
  if (!s) return null;
  // Claude Code shows Markdown's bold as bold, without its asterisks.
  const rows = s.lines.slice(-30).flatMap(l => wrap(l.text.replace(/\*\*/g, '')));
  const visible = Math.floor(BOX.h / ROW) - 1;
  // From the last steps down through the summary to its end: quick, then slowing, then still.
  const scroll = interpolate(frame, [0, duration * 0.8], [0, Math.max(0, rows.length - visible) * ROW], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  return (
    <Stacked
      lines={[
        ['You skim the changes and hope.', 0],
        ['If you review the code at all.', Math.round(duration * 0.55)],
      ]}
    >
      <div style={{ width: BOX.w, height: BOX.h, position: 'relative', overflow: 'hidden', borderRadius: 18, background: C.surface, boxShadow: SHADOW, fontFamily: MONO, fontSize: 30 }}>
        <div style={{ position: 'absolute', left: 56, right: 56, top: 28, translate: `0px ${-scroll}px` }}>
          {rows.map((r, i) => (
            <div key={i} style={{ height: ROW, whiteSpace: 'pre', color: r.startsWith('⏺') ? C.ink : r.includes('⎿  +') ? C.add : C.ink2 }}>
              {r.startsWith('⏺') ? (
                <>
                  <span style={{ color: C.claude }}>⏺</span>
                  {r.slice(1)}
                </>
              ) : (
                r || ' '
              )}
            </div>
          ))}
        </div>
      </div>
    </Stacked>
  );
};
