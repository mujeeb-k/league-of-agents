// A real Propagate run: a rename saved, "Update what depends on this", then the three folders it changed, framed
// alone: the camera goes to each as it lights up, in the order the agent worked through them, then pulls back
// to all three and the run's own numbers.
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import folders from '../../public/footage/propagate-folders.json';
import { C, SHADOW } from '../brand';
import { SPREAD } from '../data';
import { Layout, Shot, progress, type Region } from '../ui';

const RENAME_WIDE = { cx: 340, cy: 210, w: 520 };
const RENAME_LINE = { cx: 280, cy: 172, w: 440 };
const BUTTON = { cx: 965, cy: 140, w: 400 };

/** The folders in the order the agent first edited a file in each, with their labels in app pixels. */
const order = [...new Set(SPREAD.edited.map(e => e.folder))].filter(f => f in folders);
const label = (f: string) => {
  const b = (folders as Record<string, { x: number; y: number; w: number; h: number }>)[f]!;
  return { x: b.x / 2.5, y: b.y / 2.5, w: b.w / 2.5, h: b.h / 2.5 };
};
const labels = order.map(label);
// All three, and each alone: its label with its files below it.
const ALL: Region = (() => {
  const x0 = Math.min(...labels.map(l => l.x)) - 40,
    x1 = Math.max(...labels.map(l => l.x + l.w)) + 120,
    y0 = Math.min(...labels.map(l => l.y)) - 20,
    y1 = Math.max(...labels.map(l => l.y + l.h)) + 70;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(x1 - x0, ((y1 - y0) * 1760) / 810) };
})();
const ONE = (l: { x: number; y: number; w: number }): Region => ({ cx: l.x + 150, cy: l.y + 50, w: 420 });

/** The camera between keyframes, eased. */
function camera(frame: number, keys: [number, Region][]): Region {
  for (let i = keys.length - 1; i > 0; i--) {
    const [f1, b] = keys[i]!,
      [f0, a] = keys[i - 1]!;
    if (frame >= f0) {
      const t = progress(frame, f0, f1);
      return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t, w: a.w + (b.w - a.w) * t };
    }
  }
  return keys[0]![1];
}

/** `short`: the 15-second cut, which goes from the rename straight to the map. */
export const Propagate: React.FC<{ duration: number; short?: boolean }> = ({ duration, short }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const renameEnd = Math.round(duration * (short ? 0.3 : 0.28)),
    clickEnd = short ? renameEnd : Math.round(duration * 0.42);
  // After a moment on all three: a beat on each folder, then back to all three, then the numbers.
  const beat = Math.round((duration - clickEnd - 90) / order.length);
  const lit = order.map((_, i) => clickEnd + 18 + i * beat);
  const back = clickEnd + 18 + order.length * beat;
  const keys: [number, Region][] = [
    [clickEnd, ALL],
    [clickEnd + 12, ALL],
    ...labels.flatMap((l, i): [number, Region][] => [
      [lit[i]!, ONE(l)],
      [lit[i]! + beat - 8, ONE(l)],
    ]),
    [back + 12, ALL],
  ];
  const view = camera(frame, keys);
  return (
    <Layout
      place="top"
      lines={[
        ['Rename a function.', 4],
        ['See every file it worked on, across your project.', clickEnd],
      ]}
    >
      <Sequence durationInFrames={renameEnd + 8} premountFor={fps}>
        <Shot src="rename" from={RENAME_WIDE} to={RENAME_LINE} push={[10, renameEnd]} trim={3} rate={(3.8 * fps) / renameEnd} />
      </Sequence>
      {short ? null : (
        <Sequence from={renameEnd} durationInFrames={clickEnd - renameEnd + 8} premountFor={fps}>
          <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, renameEnd - 8, renameEnd) }}>
            <Shot src="propagate-start" from={BUTTON} rate={(4 * fps) / (clickEnd - renameEnd)} />
          </div>
        </Sequence>
      )}
      <Sequence from={clickEnd} premountFor={fps}>
        <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, clickEnd - 8, clickEnd) }}>
          <Shot src="propagate-end-last" still from={view}>
            {(toBox, k) =>
              labels.map((l, i) => {
                const at = lit[i]!;
                const p = toBox(l.x, l.y),
                  q = toBox(l.x + l.w, l.y + l.h);
                const on = progress(frame, at, at + 10);
                const pad = 0.35 * k * 10;
                return (
                  <div key={i}>
                    {/* Lit: a strong tint and a thick ring, clear against white; before its turn, a veil. */}
                    <div
                      style={{
                        position: 'absolute',
                        left: p.x - pad,
                        top: p.y - pad,
                        width: q.x - p.x + 2 * pad,
                        height: q.y - p.y + 2 * pad,
                        borderRadius: 14,
                        background: on > 0 ? `rgba(124, 43, 238, ${0.16 * on})` : 'rgba(255, 255, 255, 0.8)',
                        border: `6px solid rgba(124, 43, 238, ${on})`,
                        scale: String(1 + 0.08 * (1 - progress(frame, at, at + 14)) * on),
                      }}
                    />
                  </div>
                );
              })
            }
          </Shot>
          <div
            style={{
              position: 'absolute',
              right: 32,
              bottom: 32,
              padding: '18px 32px',
              borderRadius: 16,
              background: C.surface,
              boxShadow: SHADOW,
              fontSize: 44,
              fontWeight: 600,
              color: C.ink,
              fontVariantNumeric: 'tabular-nums',
              opacity: progress(frame, back + 14, back + 30),
              translate: `0px ${(1 - progress(frame, back + 14, back + 30)) * 20}px`,
            }}
          >
            {`${SPREAD.files} files · ${SPREAD.folders.length} folders · ${SPREAD.seconds} seconds`}
          </div>
        </div>
      </Sequence>
    </Layout>
  );
};
