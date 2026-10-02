// The 60-second video, one idea per scene, and the 15-second cut.
import { Series, useVideoConfig } from 'remotion';
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

/** The 60-second video: the problem, the product scene by scene, and how to get it. */
export const Main: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Series>
      <Series.Sequence name="Hook" durationInFrames={180} premountFor={fps}>
        <Hook duration={180} second={105} />
      </Series.Sequence>
      <Series.Sequence name="Skim" durationInFrames={180} premountFor={fps}>
        <Skim duration={180} />
      </Series.Sequence>
      <Series.Sequence name="Logo" durationInFrames={150} premountFor={fps}>
        <Logo />
      </Series.Sequence>
      <Series.Sequence name="Map" durationInFrames={240} premountFor={fps}>
        <Map duration={240} />
      </Series.Sequence>
      <Series.Sequence name="Point" durationInFrames={180} premountFor={fps}>
        <Point duration={180} />
      </Series.Sequence>
      <Series.Sequence name="Propagate" durationInFrames={270} premountFor={fps}>
        <Propagate duration={270} />
      </Series.Sequence>
      <Series.Sequence name="Review" durationInFrames={150} premountFor={fps}>
        <Review duration={150} />
      </Series.Sequence>
      <Series.Sequence name="Keep" durationInFrames={150} premountFor={fps}>
        <Keep duration={150} />
      </Series.Sequence>
      <Series.Sequence name="Agents" durationInFrames={90} premountFor={fps}>
        <Agents />
      </Series.Sequence>
      <Series.Sequence name="Setup" durationInFrames={120} premountFor={fps}>
        <Setup duration={120} />
      </Series.Sequence>
      <Series.Sequence name="End" durationInFrames={90} premountFor={fps}>
        <End />
      </Series.Sequence>
    </Series>
  );
};

/** The hook, the map, the change spreading with its numbers, the ending. */
export const Cut15: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <Series>
      <Series.Sequence name="Hook" durationInFrames={105} premountFor={fps}>
        <Hook duration={105} second={60} />
      </Series.Sequence>
      <Series.Sequence name="Map" durationInFrames={120} premountFor={fps}>
        <Map duration={120} trim={4.5} />
      </Series.Sequence>
      <Series.Sequence name="Propagate" durationInFrames={135} premountFor={fps}>
        <Propagate duration={135} short />
      </Series.Sequence>
      <Series.Sequence name="End" durationInFrames={90} premountFor={fps}>
        <End />
      </Series.Sequence>
    </Series>
  );
};
