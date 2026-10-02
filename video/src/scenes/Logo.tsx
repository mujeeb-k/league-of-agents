// "Introducing" over the L; the camera goes into the L, and the wordmark comes up, then the line beneath it, the
// way every line in the video comes up.
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { C } from '../brand';
import { Scene, progress } from '../ui';

const L = 240;

export const Logo: React.FC = () => {
  const frame = useCurrentFrame();
  const into = progress(frame, 34, 72);
  const enter = (at: number) => ({
    opacity: progress(frame, at, at + 14),
    translate: `0px ${(1 - progress(frame, at, at + 14)) * 10}px`,
  });
  return (
    <Scene>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 300, textAlign: 'center', fontSize: 56, fontWeight: 500, color: C.ink2, ...enter(2), opacity: progress(frame, 2, 16) * (1 - progress(frame, 30, 44)) }}>
        Introducing
      </div>
      <Img
        src={staticFile('brand/logo-512.png')}
        style={{
          position: 'absolute',
          width: L,
          height: L,
          left: 960 - L / 2,
          top: 540 - L / 2 + 40,
          borderRadius: L * 0.2,
          scale: 1 + 7 * into ** 2,
          // Solid all the way in, until its purple fills the frame; then it gives way to the name.
          opacity: progress(frame, 0, 12) * (1 - progress(frame, 66, 76)),
        }}
      />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <Img src={staticFile('brand/wordmark.png')} style={{ width: 900, height: Math.round((900 * 655) / 1445), ...enter(70) }} />
        <div style={{ fontSize: 56, fontWeight: 500, color: C.ink2, ...enter(92) }}>See every change your agents make.</div>
      </div>
    </Scene>
  );
};
