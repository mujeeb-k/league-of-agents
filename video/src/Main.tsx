// The 60-second video, one idea per scene, and the 15-second cut. The problem is dark; the reveal turns light at
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
import { through, timing } from './transitions';

/** The 60-second video: the problem, the product scene by scene, and how to get it. */
export const Main: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <TransitionSeries>
      <TransitionSeries.Sequence name="Hook" durationInFrames={135} premountFor={fps}>
        <Hook duration={135} second={80} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.fade} timing={timing} />
      <TransitionSeries.Sequence name="Skim" durationInFrames={180} premountFor={fps}>
        <Skim duration={180} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.zoom} timing={timing} />
      <TransitionSeries.Sequence name="Logo" durationInFrames={105} premountFor={fps}>
        <Logo />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.zoom} timing={timing} />
      <TransitionSeries.Sequence name="Map" durationInFrames={180} premountFor={fps}>
        <Map />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.slide} timing={timing} />
      <TransitionSeries.Sequence name="Point" durationInFrames={255} premountFor={fps}>
        <Point duration={255} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.slide} timing={timing} />
      <TransitionSeries.Sequence name="Propagate" durationInFrames={510} premountFor={fps}>
        <Propagate duration={510} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.fade} timing={timing} />
      <TransitionSeries.Sequence name="Review" durationInFrames={120} premountFor={fps}>
        <Review duration={120} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.fade} timing={timing} />
      <TransitionSeries.Sequence name="Keep" durationInFrames={120} premountFor={fps}>
        <Keep duration={120} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.slide} timing={timing} />
      <TransitionSeries.Sequence name="Agents" durationInFrames={75} premountFor={fps}>
        <Agents />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.slide} timing={timing} />
      <TransitionSeries.Sequence name="Setup" durationInFrames={120} premountFor={fps}>
        <Setup duration={120} />
      </TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={through.zoom} timing={timing} />
      <TransitionSeries.Sequence name="End" durationInFrames={150} premountFor={fps}>
        <End duration={150} />
      </TransitionSeries.Sequence>
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
