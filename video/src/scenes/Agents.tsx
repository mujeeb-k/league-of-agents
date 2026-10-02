// The agents it works with, by their own logos, as their apps ship them. Codex and Cursor are in beta.
import { Img, staticFile, useCurrentFrame } from 'remotion';
import { C } from '../brand';
import { BOX, Layout, progress } from '../ui';

// `inset`: the macOS app icons carry a margin of their own (about a tenth each side); Codex's icon has none, so
// it is shown smaller to stand the same size, never cropped or redrawn.
const AGENTS: { name: string; logo: string; inset?: number; beta?: boolean }[] = [
  { name: 'Claude Code', logo: 'logos/claude.png' },
  { name: 'Codex', logo: 'logos/codex.png', inset: 0.1, beta: true },
  { name: 'Cursor', logo: 'logos/cursor.png', beta: true },
];
const SIZE = 300;

export const Agents: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Layout place="top" lines={[['Works with Claude Code, Codex and Cursor.', 4]]}>
      <div style={{ width: BOX.w, height: BOX.h, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 160 }}>
        {AGENTS.map((a, i) => {
          const at = 14 + i * 8;
          return (
            <div key={a.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, opacity: progress(frame, at, at + 14), translate: `0px ${(1 - progress(frame, at, at + 14)) * 10}px` }}>
              <div style={{ width: SIZE, height: SIZE, padding: SIZE * (a.inset ?? 0), boxSizing: 'border-box' }}>
                <Img src={staticFile(a.logo)} style={{ width: '100%', height: '100%' }} />
              </div>
              <div style={{ fontSize: 56, fontWeight: 600 }}>{a.name}</div>
              <div style={{ height: 46, fontSize: 30, fontWeight: 500, color: C.ink2, padding: '0 14px', lineHeight: '38px', borderRadius: 10, boxShadow: a.beta ? `0 0 0 2px ${C.hair}` : 'none', visibility: a.beta ? 'visible' : 'hidden' }}>
                Beta
              </div>
            </div>
          );
        })}
      </div>
    </Layout>
  );
};
