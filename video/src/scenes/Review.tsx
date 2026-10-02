// Before, after and diff, clicked in turn; then the check that ran on its own.
import { useCurrentFrame } from 'remotion';
import { BOX, Shot, Stacked, progress } from '../ui';

const CARD = { cx: 418, cy: 355, w: 470 };
const CHECKS = { cx: 975, cy: 357, w: 300 };

export const Review: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  return (
    <Stacked lines={[['Check every line before you keep it.', 0]]}>
      <div style={{ position: 'relative', width: BOX.w, height: BOX.h }}>
        <Shot src="review" from={CARD} rate={6 / (duration / 30)} />
        <div style={{ position: 'absolute', right: 40, bottom: 40, opacity: progress(frame, duration * 0.68, duration * 0.68 + 12) }}>
          <Shot src="keep-first" still from={CHECKS} box={{ w: 760, h: 152 }} />
        </div>
      </div>
    </Stacked>
  );
};
