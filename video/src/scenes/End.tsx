// The command, the site, what it is, and where it runs: each line in turn, slowly, then the whole card holds.
import { useCurrentFrame } from 'remotion';
import { C, MONO } from '../brand';
import { Scene, progress } from '../ui';

export const End: React.FC<{ duration: number }> = ({ duration }) => {
  const frame = useCurrentFrame();
  // Four lines in the first part, about 3 s of the whole card at the end.
  const step = Math.max(10, Math.round((duration - 90 - 24) / 3));
  const enter = (i: number) => {
    const at = 6 + i * step;
    return { opacity: progress(frame, at, at + 24), translate: `0px ${(1 - progress(frame, at, at + 24)) * 24}px` };
  };
  return (
    <Scene>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36 }}>
        <div style={{ fontFamily: MONO, fontSize: 96, fontWeight: 500, ...enter(0) }}>npx leagueofagents-cli</div>
        <div style={{ fontSize: 60, fontWeight: 600, color: C.ink, ...enter(1) }}>leagueofagents.dev</div>
        <div style={{ fontSize: 46, color: C.ink2, marginTop: 24, ...enter(2) }}>Free · Open source · Runs on your machine</div>
        <div style={{ fontSize: 40, color: C.ink2, ...enter(3) }}>Available for macOS · Windows coming soon</div>
      </div>
    </Scene>
  );
};
