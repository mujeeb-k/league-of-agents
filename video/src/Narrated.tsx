// The narrated cut: the full video exactly as it is, with Kokoro's narration (capture/narration.py) laid over it,
// each line starting at its own second. No music.
import { Audio } from '@remotion/media';
import { Sequence, staticFile, useVideoConfig } from 'remotion';
import lines from '../public/narration/lines.json';
import { Main } from './Main';

export const Narrated: React.FC = () => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Main />
      {lines.map(l => (
        <Sequence key={l.id} name={`Narration: ${l.id}`} from={Math.round(l.start * fps)} durationInFrames={Math.ceil(l.seconds * fps) + 2}>
          <Audio src={staticFile(`narration/${l.id}.wav`)} />
        </Sequence>
      ))}
    </>
  );
};
