import { Composition } from 'remotion';
import { Cut15, Main } from './Main';
import { Narrated } from './Narrated';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Main" component={Main} durationInFrames={2015} fps={30} width={1920} height={1080} />
    <Composition id="Narrated" component={Narrated} durationInFrames={2015} fps={30} width={1920} height={1080} />
    <Composition id="Cut15" component={Cut15} durationInFrames={450} fps={30} width={1920} height={1080} />
  </>
);
