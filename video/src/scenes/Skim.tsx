// A real Claude Code session finishing a long task: its last steps and summary scroll past in the terminal, faster
// than anyone reads them, then "looks good", and it's done.
import { Easing, interpolate, useCurrentFrame } from 'remotion';
import { MONO } from '../brand';
import { useSession } from '../data';
import { Layout, useFrame, useInk } from '../ui';

const ROW = 42;
const COLS = 56;
const REPLY = 'looks good';
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

const Terminal: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const C = useInk();
  const { box } = useFrame();
  const s = useSession('skim-session.jsonl');
  if (!s) return null;
  // Claude Code shows Markdown's bold as bold, without its asterisks.
  const rows = s.lines.slice(-30).flatMap(l => wrap(l.text.replace(/\*\*/g, '')));
  const typedFrom = Math.round(duration * 0.62),
    sent = Math.round(duration * 0.8);
  const typed = REPLY.slice(0, Math.max(0, Math.floor((frame - typedFrom) / 2.5)));
  const done = frame >= sent;
  // Lines above the prompt: the session, and once sent, the reply.
  const all = done ? [...rows, '', `> ${REPLY}`] : rows;
  const visible = Math.floor((box.h - 190) / ROW);
  // Down through the summary to its end: quick, then slowing.
  const scroll = interpolate(frame, [0, duration * 0.55], [0, Math.max(0, rows.length - visible) * ROW], {
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });
  const shift = done ? Math.max(0, all.length - visible) * ROW : scroll;
  return (
    <div style={{ width: box.w, height: box.h, position: 'relative', overflow: 'hidden', borderRadius: 18, background: C.surface, boxShadow: C.shadow, fontFamily: MONO, fontSize: 28 }}>
      <div style={{ position: 'absolute', left: 48, right: 48, top: 28, height: box.h - 190, overflow: 'hidden' }}>
        <div style={{ translate: `0px ${-shift}px` }}>
          {all.map((r, i) => (
            <div key={i} style={{ height: ROW, whiteSpace: 'pre', color: r.startsWith('⏺') || r.startsWith('>') ? C.ink : r.includes('⎿  +') ? C.add : C.ink2 }}>
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
      {/* Claude Code's prompt: a rounded box with ">" where the person types. */}
      <div style={{ position: 'absolute', left: 40, right: 40, bottom: 48, height: 92, borderRadius: 14, border: `2px solid ${C.ink2}`, display: 'flex', alignItems: 'center', padding: '0 28px', color: C.ink, gap: 18 }}>
        <span style={{ color: C.ink2 }}>&gt;</span>
        <span>{done ? '' : typed}</span>
        <span style={{ width: 16, height: 36, background: C.ink, opacity: Math.floor(frame / 15) % 2 ? 0.2 : 0.9 }} />
      </div>
    </div>
  );
};

export const Skim: React.FC<{ duration: number }> = ({ duration }) => (
  <Layout
    dark
    place="left"
    lines={[
      ['You skim the changes and hope.', 0],
      ['If you review the code at all.', Math.round(duration * 0.55)],
    ]}
  >
    <Terminal duration={duration} />
  </Layout>
);
