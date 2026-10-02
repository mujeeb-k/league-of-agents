// Keep, then a revert that undoes the whole run, on the Propagate run's four files.
import { Shot, Stacked } from '../ui';

const WIDE = { cx: 700, cy: 470, w: 900 };
const BUTTONS = { cx: 990, cy: 610, w: 470 };

export const Keep: React.FC<{ duration: number }> = ({ duration }) => (
  <Stacked lines={[['Keep it, or undo it in one click.', 0]]}>
    <Shot src="keep" from={WIDE} to={BUTTONS} push={[8, Math.round(duration * 0.35)]} trim={0.3} rate={6.6 / (duration / 30)} />
  </Stacked>
);
