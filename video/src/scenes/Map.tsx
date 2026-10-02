// The whole project, then in with the app's own zoom: folders with their files' names, then one file's code.
import { Layout, Shot } from '../ui';

// App pixels: the canvas below the top bar, all of it; the zoom is the app's, never a crop.
const WIDE = { cx: 576, cy: 310, w: 1100 };

/**
 * `trim`: where in the clip to start, in seconds, past its still opening; `rate`: how fast it plays. It ends on the
 * code and holds there for the rest of the scene. The 15-second cut starts part way in, at the folders.
 */
export const Map: React.FC<{ trim?: number; rate?: number }> = ({ trim = 2.4, rate = 1.5 }) => (
  <Layout place="over" lines={[['Your whole project, on one screen.', 8]]}>
    <Shot src="map" from={WIDE} trim={trim} rate={rate} />
  </Layout>
);
