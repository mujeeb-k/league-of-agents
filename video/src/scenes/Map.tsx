// The whole project, then in with the app's own zoom: folders with their files' names, then code.
import { useVideoConfig } from 'remotion';
import clips from '../../public/footage/clips.json';
import { BOX, Shot, Stacked } from '../ui';

// App pixels: the canvas below the top bar, all of it; the zoom is the app's, never a crop.
const WIDE = { cx: 576, cy: 300, w: 1152 };

/** `trim`: where in the clip to start, in seconds (the 15-second cut starts part way in). */
export const Map: React.FC<{ duration: number; trim?: number }> = ({ duration, trim = 1 }) => {
  const { fps } = useVideoConfig();
  return (
    <Stacked lines={[['Your whole project, on one screen.', 0]]}>
      <div style={{ position: 'relative', width: BOX.w, height: BOX.h }}>
        <Shot src="map" from={WIDE} trim={trim} rate={((clips.map - trim) * fps) / duration} />
      </div>
    </Stacked>
  );
};
