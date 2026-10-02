// The real session scrolls fast, and the count of its actions ticks with it.
import { interpolate, useCurrentFrame } from 'remotion';
import { C, MONO, SHADOW } from '../brand';
import { useSession } from '../data';
import { BOX, Stacked, progress } from '../ui';

export const Hook: React.FC<{ duration: number; second: number }> = ({ duration, second }) => {
  const frame = useCurrentFrame();
  const s = useSession();
  if (!s) return null;
  const end = Math.round(duration * 0.8);
  const shown = Math.floor(interpolate(frame, [6, end], [0, s.lines.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const actions = s.lines[Math.max(0, shown - 1)]?.action ?? 0;
  const ROW = 44;
  return (
    <Stacked
      lines={[
        [`Claude Code just took ${s.actions} actions.`, 0],
        ['What did it change?', second],
      ]}
    >
      <div
        style={{
          width: BOX.w,
          height: BOX.h,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 18,
          background: C.surface,
          boxShadow: SHADOW,
          fontFamily: MONO,
          fontSize: 30,
        }}
      >
        <div style={{ position: 'absolute', left: 56, right: 520, bottom: 40, translate: '0px 0px' }}>
          {s.lines.slice(0, shown).slice(-16).map((l, i) => (
            <div key={i} style={{ height: ROW, whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', color: l.text.startsWith('⏺') ? C.ink : l.text.includes('⎿  +') ? C.add : C.ink2 }}>
              {l.text.startsWith('⏺') ? (
                <>
                  <span style={{ color: C.claude }}>⏺</span>
                  {l.text.slice(1)}
                </>
              ) : (
                l.text
              )}
            </div>
          ))}
        </div>
        <div
          style={{
            position: 'absolute',
            right: 56,
            top: 0,
            bottom: 0,
            width: 420,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 8,
            fontFamily: 'inherit',
            opacity: progress(frame, 4, 16),
          }}
        >
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 220, fontWeight: 600, lineHeight: 1, color: C.ink, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.04em' }}>
            {actions}
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 40, color: C.ink2 }}>actions</div>
        </div>
      </div>
    </Stacked>
  );
};
