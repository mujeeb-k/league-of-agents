// Before, after and diff, clicked in turn, in the dark theme: a focus mode for reading code. Then the check that
// ran on its own.
import { useCurrentFrame } from 'remotion';
import { Layout, Shot, progress } from '../ui';

const CARD = { cx: 418, cy: 355, w: 470 };
const CHECKS = { cx: 990, cy: 480, w: 300 };

export const Review: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return (
    <Layout dark place="right" lines={[['Check every line before you keep it.', 6]]}>
      <Shot src="review-dark" from={CARD} rate={6 / (duration / 30)} />
      <div style={{ position: 'absolute', left: 40, bottom: 40, opacity: progress(frame, duration * 0.68, duration * 0.68 + 12) }}>
        <Shot src="checks-dark" still from={CHECKS} box={{ w: 760, h: 170 }} />
      </div>
    </Layout>
  );
};
