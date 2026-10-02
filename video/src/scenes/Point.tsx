// Select a block, ⌘K, the prompt, run; then a quick edit by hand. Close in, so the code reads.
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { Layout, Shot, progress } from '../ui';

const EDITOR = { cx: 340, cy: 360, w: 520 };
const COMPOSER = { cx: 300, cy: 600, w: 420 };
const EDIT_WIDE = { cx: 300, cy: 260, w: 520 };
const EDIT_LINE = { cx: 260, cy: 200, w: 420 };

export const Point: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const split = Math.round(duration * 0.62);
  return (
    <Layout
      place="left"
      lines={[
        ['Select the exact lines for your agent to work on.', 6],
        ['Or edit the file yourself.', split],
      ]}
    >
      <Sequence durationInFrames={split + 8} premountFor={fps}>
        <Shot src="point" from={EDITOR} to={COMPOSER} push={[Math.round(split * 0.7), split]} trim={1.5} rate={(5.5 * fps) / split} />
      </Sequence>
      <Sequence from={split} premountFor={fps}>
        <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, split - 8, split) }}>
          <Shot src="edit" from={EDIT_WIDE} to={EDIT_LINE} push={[25, duration - split]} trim={3} rate={(3.8 * fps) / (duration - split)} />
        </div>
      </Sequence>
    </Layout>
  );
};
