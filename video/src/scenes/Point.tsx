// Select a block, ⌘K, the prompt, run; then a quick edit by hand.
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { BOX, Shot, Stacked, progress } from '../ui';

const EDITOR = { cx: 420, cy: 360, w: 760 };
const COMPOSER = { cx: 330, cy: 632, w: 470 };
const EDIT_WIDE = { cx: 420, cy: 280, w: 700 };
const EDIT_LINE = { cx: 300, cy: 172, w: 600 };

export const Point: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const split = Math.round(duration * 0.64);
  return (
    <Stacked
      lines={[['Select the exact lines for your agent to work on, or edit the file yourself.', 0]]}
    >
      <div style={{ position: 'relative', width: BOX.w, height: BOX.h }}>
        <Sequence durationInFrames={split + 8} premountFor={fps}>
          <Shot src="point" from={EDITOR} to={COMPOSER} push={[Math.round(split * 0.7), split]} trim={1.5} rate={(5.5 * fps) / split} />
        </Sequence>
        <Sequence from={split} premountFor={fps}>
          <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, split - 8, split) }}>
            <Shot src="edit" from={EDIT_WIDE} to={EDIT_LINE} push={[25, duration - split]} trim={3} rate={(3.8 * fps) / (duration - split)} />
          </div>
        </Sequence>
      </div>
    </Stacked>
  );
};
