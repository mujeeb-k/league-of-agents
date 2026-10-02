// The turn to light: "Introducing" small above the wordmark, then the line beneath it, each coming up in turn.
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { C } from '../brand';
import { Scene, progress } from '../ui';

const W = 1000,
  H = Math.round((1000 * 655) / 1445);

export const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = (at: number, rise = 30) => ({
    opacity: progress(frame, at, at + 20),
    translate: `0px ${(1 - progress(frame, at, at + 20)) * rise}px`,
  });
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36 }}>
        <div style={{ fontSize: 44, fontWeight: 500, letterSpacing: '0.04em', color: C.ink2, ...enter(4) }}>Introducing</div>
        <Img
          src={staticFile('brand/wordmark.png')}
          style={{ width: W, height: H, ...enter(14, 20), scale: String(0.96 + 0.04 * progress(frame, 14, 40)) }}
        />
        <div style={{ fontSize: 64, fontWeight: 600, letterSpacing: '-0.02em', ...enter(40) }}>See every change your agents make.</div>
      </div>
    </Scene>
  );
};
