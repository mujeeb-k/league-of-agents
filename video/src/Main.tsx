// The video (about 67 seconds), one idea per scene, and the 15-second cut. The problem is dark; the reveal turns light at
// the wordmark; Review goes dark again to read code. Scenes zoom, slide or fade into each other (15 frames each, transitions.tsx),
// so each scene's length includes the transition into the next.
import { TransitionSeries } from '@remotion/transitions';
import { useVideoConfig } from 'remotion';
import './brand';
import { Agents } from './scenes/Agents';
import { End } from './scenes/End';
import { Hook } from './scenes/Hook';
import { Keep } from './scenes/Keep';
import { Logo } from './scenes/Logo';
import { Map } from './scenes/Map';
import { Point } from './scenes/Point';
import { Propagate } from './scenes/Propagate';
import { Review } from './scenes/Review';
import { Setup } from './scenes/Setup';
import { Skim } from './scenes/Skim';
import TIMING from './timing.json';
import { through, timing } from './transitions';

type Scene = keyof typeof TIMING.scenes;
/** Each scene's length in frames, the transition into the next included. */
export type Lengths = Record<Scene, number>;
export const MAIN: Lengths = TIMING.scenes;
/** A cut's length: its scenes, less the overlap of each transition. */
export const total = (l: Lengths) => Object.values(l).reduce((a, b) => a + b, 0) - TIMING.transition * (Object.keys(l).length - 1);

const SCENES: [Scene, (d: number) => React.ReactNode][] = [
  ['Hook', d => <Hook duration={d} second={80} />],
  ['Skim', d => <Skim duration={d} />],
  ['Logo', () => <Logo />],
  ['Map', () => <Map />],
  ['Point', d => <Point duration={d} />],
  ['Propagate', d => <Propagate duration={d} />],
  ['Review', d => <Review duration={d} />],
  ['Keep', d => <Keep duration={d} />],
  ['Agents', () => <Agents />],
  ['Setup', d => <Setup duration={d} />],
  ['End', d => <End duration={d} />],
];
const INTO: (keyof typeof through)[] = ['fade', 'zoom', 'zoom', 'slide', 'slide', 'fade', 'fade', 'slide', 'slide', 'zoom'];

/** One scene into the next. */
const transition = (kind: keyof typeof through, key: string) =>
  kind === 'zoom' ? (
    <TransitionSeries.Transition key={key} presentation={through.zoom} timing={timing} />
  ) : kind === 'slide' ? (
    <TransitionSeries.Transition key={key} presentation={through.slide} timing={timing} />
  ) : (
    <TransitionSeries.Transition key={key} presentation={through.fade} timing={timing} />
  );

/** The full video: the problem, the product scene by scene, and how to get it. */
export const Main: React.FC<{ lengths?: Lengths }> = ({ lengths = MAIN }) => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      {SCENES.flatMap(([name, scene], i) => [
        <TransitionSeries.Sequence key={name} name={name} durationInFrames={lengths[name]} premountFor={fps}>
          {scene(lengths[name])}
        </TransitionSeries.Sequence>,
        ...(i < INTO.length ? [transition(INTO[i]!, `${name}-into`)] : []),
      ])}
    </TransitionSeries>
  );
};

/** The hook, the map, the change spreading with its numbers, the ending. */
export const Cut15: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={105} premountFor={fps}>
        <Hook duration={105} second={60} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.zoom} timing={timing} />
      <TransitionSeries.Sequence name="Map" durationInFrames={120} premountFor={fps}>
        <Map trim={5.5} rate={2} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.slide} timing={timing} />
      <TransitionSeries.Sequence name="Propagate" durationInFrames={150} premountFor={fps}>
        <Propagate duration={150} short />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.zoom} timing={timing} />
      <TransitionSeries.Sequence name="End" durationInFrames={120} premountFor={fps}>
        <End duration={120} />
      </TransitionSeries.Sequence>
    </TransitionSeries>
  );
};
