// The command, the site, and what it is.
import { useCurrentFrame } from 'remotion';
import { C, MONO } from '../brand';
import { Scene, progress } from '../ui';

export const End: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = (at: number) => ({ opacity: progress(frame, at, at + 14), translate: `0px ${(1 - progress(frame, at, at + 14)) * 10}px` });
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36 }}>
        <div style={{ fontFamily: MONO, fontSize: 96, fontWeight: 500, ...enter(0) }}>npx leagueofagents-cli</div>
        <div style={{ fontSize: 56, fontWeight: 500, color: C.ink, ...enter(8) }}>leagueofagents.dev</div>
        <div style={{ fontSize: 44, color: C.ink2, marginTop: 24, ...enter(18) }}>Free · Open source · Runs on your machine</div>
        <div style={{ fontSize: 36, color: C.ink2, ...enter(26) }}>Available for macOS · Windows coming soon</div>
      </div>
    </Scene>
  );
};
