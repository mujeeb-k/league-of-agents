// The two ways to set it up, as the site gives them: a line to paste into your agent, or the command. Each Copy
// is clicked, and says so.
import { useCurrentFrame } from 'remotion';
import { C, MONO, SHADOW } from '../brand';
import { BOX, Layout, progress } from '../ui';

export const SETUP = 'Read leagueofagents.dev/setup.md and set up League of Agents in this repo.';
const ROWS = [
  { label: 'Paste into your agent', text: SETUP, mono: false },
  { label: 'Or run', text: 'npx leagueofagents-cli', mono: true },
];
const W = 1400,
  H = 150,
  GAP = 90,
  TOP = (BOX.h - 2 * (H + 56) - GAP) / 2;
// Lucide's copy and check, the icons the app's Copy button uses.
const Copy = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="8" y="8" width="14" height="14" rx="2" />
    <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
  </svg>
);
const Tick = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.add} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const Setup: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const clicks = [Math.round(duration * 0.32), Math.round(duration * 0.68)];
  // Where each Copy button sits, for the cursor.
  const button = (i: number) => ({ x: (BOX.w + W) / 2 - 110, y: TOP + 56 + i * (H + 56 + GAP) + H / 2 });
  const path = [{ x: BOX.w / 2, y: BOX.h - 40 }, button(0), button(1)];
  const seg = (i: number) => progress(frame, clicks[i]! - 26, clicks[i]! - 4);
  const at = frame < clicks[0]! ? 0 : 1;
  const from = path[at]!,
    to = path[at + 1]!,
    t = seg(at);
  const cursor = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
  return (
    <Layout place="top" lines={[['Set it up with one line.', 4]]}>
      <div style={{ position: 'relative', width: BOX.w, height: BOX.h }}>
        {ROWS.map((r, i) => {
          const copied = frame >= clicks[i]!;
          const pressed = Math.abs(frame - clicks[i]!) < 3;
          return (
            <div key={r.label} style={{ position: 'absolute', left: (BOX.w - W) / 2, top: TOP + i * (H + 56 + GAP), width: W, opacity: progress(frame, 4 + i * 8, 18 + i * 8) }}>
              <div style={{ fontSize: 34, fontWeight: 500, color: C.ink2, marginBottom: 18 }}>{r.label}</div>
              <div style={{ height: H, borderRadius: 22, background: C.surface, boxShadow: SHADOW, display: 'flex', alignItems: 'center', gap: 24, padding: '0 24px 0 44px' }}>
                <div style={{ flex: 1, fontFamily: r.mono ? MONO : undefined, fontSize: r.mono ? 44 : 36, lineHeight: 1.3, color: C.ink }}>{r.text}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, height: 76, padding: '0 26px', borderRadius: 14, fontSize: 32, fontWeight: 500, color: C.ink, background: pressed ? '#e4e4e7' : '#f4f4f5', minWidth: 200, justifyContent: 'center' }}>
                  {copied ? <Tick /> : <Copy />}
                  {copied ? 'Copied' : 'Copy'}
                </div>
              </div>
            </div>
          );
        })}
        <svg width="40" height="56" viewBox="0 0 14 20" style={{ position: 'absolute', left: cursor.x, top: cursor.y, opacity: progress(frame, 8, 16) }}>
          <path d="M1 1 L1 16 L5 12 L8 19 L10 18 L7 11 L12 11 Z" fill={C.ink} stroke="#fff" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </div>
    </Layout>
  );
};
