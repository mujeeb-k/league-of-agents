import { Composition } from 'remotion';
import { Cut15, Main } from './Main';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={1800} fps={30} width={1920} height={1080} />
    <Composition id="Cut15" component={Cut15} durationInFrames={450} fps={30} width={1920} height={1080} />
  </>
);
