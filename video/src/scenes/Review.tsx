// Before, after and diff, clicked in turn, in the dark theme: a focus mode for reading code. Beside it, the line,
// and beneath it what each view is, lit while it shows; then the check that ran on its own.
import { useCurrentFrame } from 'remotion';
import { Layout, Shot, progress, useInk } from '../ui';

const CARD = { cx: 418, cy: 355, w: 470 };
const CHECKS = { cx: 990, cy: 480, w: 300 };
/** The clip from 1 s: where it switches to each view, in seconds of the clip; then the checks, in scene frames. */
const TRIM = 1;
const AT: [string, number][] = [
  ['Before.', 1.4],
  ['After.', 3.4],
  ['Diff.', 5.3],
];
/** The scene's full length at the clip's own speed; a shorter scene plays it quicker, in proportion. */
const FULL = 210;
const views = (pace: number): [string, number][] => [
  ...AT.map(([name, t]): [string, number] => [name, Math.round((t - TRIM) * 30 * pace)]),
  ['Checks.', Math.round(160 * pace)],
];

const Views: React.FC<{ VIEWS: [string, number][] }> = ({ VIEWS }) => {
  const frame = useCurrentFrame();
  const C = useInk();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {VIEWS.map(([name, at], i) => {
        const next = VIEWS[i + 1]?.[1];
        // Lit while its view shows; before and after that, dim. The last stays lit.
        const lit = progress(frame, at, at + 10) * (next === undefined ? 1 : 1 - progress(frame, next, next + 10));
        return (
          <div key={name} style={{ fontSize: 76, fontWeight: 600, letterSpacing: '-0.025em', lineHeight: 1.1, color: C.ink, opacity: progress(frame, 6, 24) * (0.25 + 0.75 * lit) }}>
            {name}
          </div>
        );
      })}
    </div>
  );
};

export const Review: React.FC<{ duration?: number }> = ({ duration = FULL }) => {
  const frame = useCurrentFrame();
  const pace = duration / FULL;
  const VIEWS = views(pace);
  return (
    <Layout dark place="right" lines={[['Check every line before you keep it.', 6]]} aside={<Views VIEWS={VIEWS} />}>
      <Shot src="review-dark" from={CARD} trim={TRIM} rate={1 / pace} />
      <div style={{ position: 'absolute', left: 40, bottom: 40, opacity: progress(frame, VIEWS[3]![1], VIEWS[3]![1] + 12) }}>
        <Shot src="checks-dark" still from={CHECKS} box={{ w: 760, h: 170 }} />
      </div>
    </Layout>
  );
};
