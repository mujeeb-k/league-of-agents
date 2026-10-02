// Before, after and diff, clicked in turn, in the dark theme: a focus mode for reading code. Beside it, the line,
// and beneath it what each view is, lit while it shows; then the check that ran on its own.
import { useCurrentFrame } from 'remotion';
import { Layout, Shot, progress, useInk } from '../ui';

const CARD = { cx: 418, cy: 355, w: 470 };
const CHECKS = { cx: 990, cy: 480, w: 300 };
/** The clip from 1 s, at its own speed: where it switches to each view, in scene frames; then the checks. */
const TRIM = 1;
const VIEWS: [string, number][] = [
  ['Before.', Math.round((1.4 - TRIM) * 30)],
  ['After.', Math.round((3.4 - TRIM) * 30)],
  ['Diff.', Math.round((5.3 - TRIM) * 30)],
  ['Checks.', 160],
];

const Views: React.FC = () => {
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

export const Review: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Layout dark place="right" lines={[['Check every line before you keep it.', 6]]} aside={<Views />}>
      <Shot src="review-dark" from={CARD} trim={TRIM} />
      <div style={{ position: 'absolute', left: 40, bottom: 40, opacity: progress(frame, VIEWS[3]![1], VIEWS[3]![1] + 12) }}>
        <Shot src="checks-dark" still from={CHECKS} box={{ w: 760, h: 170 }} />
      </div>
    </Layout>
  );
};
