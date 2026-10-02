// Keep, then a revert that undoes the whole run, on the Propagate run's four files. Close in, so the words read.
import { Layout, Shot } from '../ui';

const WIDE = { cx: 760, cy: 520, w: 640 };
const BUTTONS = { cx: 990, cy: 610, w: 360 };

export const Keep: React.FC<{ duration: number }> = ({ duration }) => (
  <Layout place="top" lines={[['Keep it, or undo it in one click.', 6]]}>
    <Shot src="keep" from={WIDE} to={BUTTONS} push={[8, Math.round(duration * 0.35)]} trim={0.3} rate={6.6 / (duration / 30)} />
  </Layout>
);
