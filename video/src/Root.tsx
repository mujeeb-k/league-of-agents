import { Composition } from 'remotion';
import { Cut15, MAIN, Main, total } from './Main';
import { Narrated, lengthsOf } from './Narrated';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={total(MAIN)} fps={30} width={1920} height={1080} />
    <Composition
      id="Narrated"
      component={Narrated}
      defaultProps={{ cut: 'documentary' as const }}
      durationInFrames={total(lengthsOf('documentary'))}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="NarratedClear"
      component={Narrated}
      defaultProps={{ cut: 'clear' as const }}
      durationInFrames={total(lengthsOf('clear'))}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition id="Cut15" component={Cut15} durationInFrames={450} fps={30} width={1920} height={1080} />
  </>
);
