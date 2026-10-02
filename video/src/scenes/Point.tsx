// Select a block for the agent, close in; then, unhurried, a file's editor opening over the dimmed map, a line
// typed, saved, and "Saved as run".
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { Layout, Shot, progress } from '../ui';

const EDITOR = { cx: 340, cy: 330, w: 560 };
const COMPOSER = { cx: 320, cy: 560, w: 480 };
// The canvas, without the side panels: the editor large, the dimmed map around it, and the save's toast.
const CANVAS = { cx: 418, cy: 325, w: 835 };

export const Point: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const split = Math.round(duration * 0.4);
  return (
    <Layout
      place="wide"
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
          <Shot src="edit" from={CANVAS} trim={0.9} rate={(6.3 * fps) / (duration - split - 12)} />
        </div>
      </Sequence>
    </Layout>
  );
};
