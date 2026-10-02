// The narrated cuts: the full video with each cut's scene lengths (timing.json), and Kokoro's narration
// (capture/narration.py) laid over it, each line starting at its own second. No music.
import { Audio } from '@remotion/media';
import { Sequence, staticFile, useVideoConfig } from 'remotion';
import clear from '../public/narration/clear/lines.json';
import documentary from '../public/narration/documentary/lines.json';
import { Main, type Lengths } from './Main';
import TIMING from './timing.json';

const LINES = { documentary, clear };
export type Cut = keyof typeof LINES;
/** A cut's scene lengths. */
export const lengthsOf = (cut: Cut): Lengths => ({ ...TIMING.scenes, ...TIMING[cut] });

export const Narrated: React.FC<{ cut: Cut }> = ({ cut }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      <Main lengths={lengthsOf(cut)} />
      {LINES[cut].map(l => (
        <Sequence key={l.id} name={`Narration: ${l.id}`} from={Math.round(l.start * fps)} durationInFrames={Math.ceil(l.seconds * fps) + 2}>
          <Audio src={staticFile(`narration/${cut}/${l.id}.wav`)} />
        </Sequence>
      ))}
    </>
  );
};
