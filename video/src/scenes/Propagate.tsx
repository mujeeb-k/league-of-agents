// A real Propagate run: a rename saved, "Update what depends on this", and the folders it changed lighting up
// across the map in the order the agent edited them. The caption's numbers are the run's own.
import { Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import folders from '../../public/footage/propagate-folders.json';
import { C, SHADOW } from '../brand';
import { SPREAD } from '../data';
import { BOX, Shot, Stacked, progress } from '../ui';

const RENAME_WIDE = { cx: 420, cy: 200, w: 620 };
const RENAME_LINE = { cx: 300, cy: 172, w: 600 };
const BUTTON = { cx: 965, cy: 140, w: 400 };
const SPREAD_MAP = { cx: 450, cy: 320, w: 880 };

/** The folders in the order the agent first edited a file in each. */
const order = [...new Set(SPREAD.edited.map(e => e.folder))];

/** `short`: the 15-second cut, which goes from the rename straight to the map. */
export const Propagate: React.FC<{ duration: number; short?: boolean }> = ({ duration, short }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const renameEnd = Math.round(duration * (short ? 0.3 : 0.28)),
    clickEnd = short ? renameEnd : Math.round(duration * 0.42);
  const lit = (folder: string) => {
    const i = order.indexOf(folder);
    return i < 0 ? clickEnd : clickEnd + 18 + i * Math.round((duration - clickEnd - 70) / order.length);
  };
  const captionAt = lit(order[order.length - 1]!) + 20;
  return (
    <Stacked
      lines={[
        ['Rename a function.', 0],
        ['See every file it touched, across your project.', clickEnd],
      ]}
    >
      <div style={{ position: 'relative', width: BOX.w, height: BOX.h }}>
        <Sequence durationInFrames={renameEnd + 8} premountFor={fps}>
          <Shot src="rename" from={RENAME_WIDE} to={RENAME_LINE} push={[10, renameEnd]} trim={3} rate={(3.8 * fps) / renameEnd} />
        </Sequence>
        {short ? null : (
          <Sequence from={renameEnd} durationInFrames={clickEnd - renameEnd + 8} premountFor={fps}>
            <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, renameEnd - 8, renameEnd) }}>
              <Shot src="propagate-start" from={BUTTON} rate={(4 * fps) / (clickEnd - renameEnd)} />
            </div>
          </Sequence>
        )}
        <Sequence from={clickEnd} premountFor={fps}>
          <div style={{ position: 'absolute', inset: 0, opacity: progress(frame, clickEnd - 8, clickEnd) }}>
            <Shot src="propagate-end-last" still from={SPREAD_MAP}>
              {toBox =>
                Object.entries(folders).map(([folder, b]) => {
                  const at = lit(folder);
                  const p = toBox(b.x / 2.5, b.y / 2.5),
                    q = toBox((b.x + b.w) / 2.5, (b.y + b.h) / 2.5);
                  const on = progress(frame, at, at + 8);
                  const ring = progress(frame, at, at + 24);
                  return (
                    <div key={folder}>
                      {/* Until the agent reaches it, the folder waits under a veil; then it shows, with a ring that widens once. */}
                      <div style={{ position: 'absolute', left: p.x - 8, top: p.y - 6, width: q.x - p.x + 16, height: q.y - p.y + 12, borderRadius: 10, background: C.surface, opacity: 0.85 * (1 - on) }} />
                      <div
                        style={{
                          position: 'absolute',
                          left: p.x - 10,
                          top: p.y - 8,
                          width: q.x - p.x + 20,
                          height: q.y - p.y + 16,
                          borderRadius: 12,
                          border: `4px solid ${C.accent}`,
                          opacity: on * (1 - 0.6 * ring),
                          scale: 1 + 0.15 * ring,
                        }}
                      />
                    </div>
                  );
                })
              }
            </Shot>
            <div
              style={{
                position: 'absolute',
                right: 28,
                bottom: 28,
                padding: '14px 26px',
                borderRadius: 14,
                background: C.surface,
                boxShadow: SHADOW,
                fontSize: 34,
                fontWeight: 500,
                color: C.ink,
                fontVariantNumeric: 'tabular-nums',
                opacity: progress(frame, captionAt, captionAt + 12),
              }}
            >
              {`${SPREAD.files} files · ${SPREAD.folders.length} folders · ${SPREAD.seconds} seconds`}
            </div>
          </div>
        </Sequence>
      </div>
    </Stacked>
  );
};
