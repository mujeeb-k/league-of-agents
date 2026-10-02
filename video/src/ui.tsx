// The video's layout. Each scene puts its product in a box and its words beside, above, over or around it; the
// words come in moving, one line at a time. The problem scenes and Review are dark, everything else light.
import { Video } from '@remotion/media';
import { createContext, useContext } from 'react';
import type React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import clips from '../public/footage/clips.json';
import { C, D, SANS, SHADOW, SHADOW_DARK } from './brand';

const ease = Easing.bezier(0.33, 0, 0.2, 1);
/** 0 to 1 between two frames, eased, clamped. */
export const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

type Box = { x: number; y: number; w: number; h: number };
/** The product's box with the words above it: 1760 × 810. */
export const BOX: Box = { x: 80, y: 240, w: 1760, h: 810 };
// The app's own shape (1152 × 720), for scenes that show all of it.
const WIDE: Box = { x: 240, y: 170, w: 1440, h: 900 };
const SIDE_LEFT: Box = { x: 780, y: 80, w: 1060, h: 920 },
  SIDE_RIGHT: Box = { x: 80, y: 80, w: 1060, h: 920 },
  FULL: Box = { x: 80, y: 80, w: 1760, h: 920 };

/** Whether the scene is dark, and its product box; Shot and the scene's own parts read them. */
const Frame = createContext<{ dark: boolean; box: Box }>({ dark: false, box: BOX });
export const useFrame = () => useContext(Frame);
/** The theme's colours for the scene: light, or the app's dark theme. */
export const useInk = () => {
  const { dark } = useFrame();
  return dark ? { ...C, ...D, shadow: SHADOW_DARK } : { ...C, shadow: SHADOW };
};

export const Scene: React.FC<{ dark?: boolean; children: React.ReactNode }> = ({ dark = false, children }) => (
  <AbsoluteFill style={{ background: dark ? D.canvas : C.canvas, fontFamily: SANS, color: dark ? D.ink : C.ink }}>
    {children}
  </AbsoluteFill>
);

/**
 * Lines that take turns: each [text, from frame] slides up into place and fades in, and slides on up and out
 * when the next one comes.
 */
export const Lines: React.FC<{ lines: [string, number][]; size: number; align?: 'left' | 'center' }> = ({
  lines,
  size,
  align = 'left',
}) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {lines.map(([text, from], i) => {
        const next = lines[i + 1]?.[1];
        const enter = progress(frame, from, from + 18),
          leave = next === undefined ? 0 : progress(frame, next - 12, next);
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: align === 'center' ? 'center' : 'flex-start',
              textAlign: align,
              fontSize: size,
              fontWeight: 600,
              lineHeight: 1.08,
              letterSpacing: '-0.025em',
              textWrap: 'balance',
              opacity: enter * (1 - leave),
              translate: `0px ${(1 - enter) * 40 - leave * 30}px`,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
  );
};

/**
 * A scene: its words and its product, placed one of five ways.
 * - top: the words above the product, centred;
 * - wide: the same, with the whole app in its own shape below;
 * - left / right: the words in a column beside the product;
 * - over: the product filling the frame, the words on a card over its upper left;
 * - center: the words alone, centred (children sit below them).
 */
export const Layout: React.FC<{
  lines: [string, number][];
  place: 'top' | 'wide' | 'left' | 'right' | 'over';
  dark?: boolean;
  children: React.ReactNode;
}> = ({ lines, place, dark = false, children }) => {
  const box =
    place === 'top' ? BOX : place === 'wide' ? WIDE : place === 'left' ? SIDE_LEFT : place === 'right' ? SIDE_RIGHT : FULL;
  const words: React.CSSProperties =
    place === 'top'
      ? { left: BOX.x, right: BOX.x, top: 30, height: 190 }
      : place === 'wide'
        ? { left: BOX.x, right: BOX.x, top: 10, height: 160 }
      : place === 'left'
        ? { left: 100, width: 600, top: 80, height: 920 }
        : place === 'right'
          ? { left: 1200, width: 620, top: 80, height: 920 }
          : { left: 140, top: 130, width: 1060, height: 200 };
  return (
    <Scene dark={dark}>
      <Frame.Provider value={{ dark, box }}>
        {/* Sized, so a Sequence's full-frame wrapper inside it fills the box rather than collapsing. */}
        <div style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h }}>{children}</div>
        {place === 'over' ? (
          <div
            style={{
              position: 'absolute',
              ...words,
              borderRadius: 24,
              background: dark ? D.surface : C.surface,
              boxShadow: dark ? SHADOW_DARK : SHADOW,
              padding: '0 56px',
            }}
          >
            <Lines lines={lines} size={72} />
          </div>
        ) : (
          <div style={{ position: 'absolute', ...words }}>
            <Lines
              lines={lines}
              size={place === 'wide' ? 72 : place === 'top' ? 80 : 84}
              align={place === 'top' || place === 'wide' ? 'center' : 'left'}
            />
          </div>
        )}
      </Frame.Provider>
    </Scene>
  );
};

/** A region of the app, in its own pixels (the footage is the app at 1152 × 720, drawn at 2.5×). */
export type Region = { cx: number; cy: number; w: number };
const lerp = (a: Region, b: Region, t: number): Region => ({
  cx: a.cx + (b.cx - a.cx) * t,
  cy: a.cy + (b.cy - a.cy) * t,
  w: a.w + (b.w - a.w) * t,
});

/**
 * The product, filling the scene's box (or `box`): a clip (public/footage/<src>.mp4) or a still (<src>.jpg),
 * showing `from` and moving to `to` between frames `push[0]` and `push[1]` (a slow push in). A clip plays from
 * `trim` seconds at `rate` times its speed, then holds its last frame.
 */
export const Shot: React.FC<{
  src: string;
  still?: boolean;
  from: Region;
  to?: Region;
  push?: [number, number];
  trim?: number;
  rate?: number;
  box?: { w: number; h: number };
  style?: React.CSSProperties;
  children?: (toBox: (x: number, y: number) => { x: number; y: number }, k: number) => React.ReactNode;
}> = ({ src, still, from, to = from, push = [0, 1], trim = 0, rate = 1, box: given, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { dark, box: scene } = useFrame();
  const box = given ?? scene;
  const r = lerp(from, to, progress(frame, push[0], push[1]));
  const k = box.w / (r.w * 2.5); // footage pixels to box pixels
  const h = box.h / k / 2.5; // region height in app pixels
  const left = -(r.cx - r.w / 2) * 2.5 * k,
    top = -(r.cy - h / 2) * 2.5 * k;
  const media: React.CSSProperties = { position: 'absolute', left, top, width: 2880 * k, height: 1800 * k, maxWidth: 'none' };
  // App pixels to box pixels, for overlays drawn on the product.
  const toBox = (x: number, y: number) => ({ x: left + x * 2.5 * k, y: top + y * 2.5 * k });
  return (
    <div
      style={{
        width: box.w,
        height: box.h,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 18,
        background: dark ? D.surface : C.surface,
        boxShadow: dark ? SHADOW_DARK : SHADOW,
        ...style,
      }}
    >
      {still ? (
        <Img src={staticFile(`footage/${src}.jpg`)} style={media} />
      ) : (
        <>
          <Img src={staticFile(`footage/${src}-last.jpg`)} style={media} />
          <Sequence durationInFrames={Math.floor(((clipLength(src) - trim) * fps) / rate)} premountFor={fps}>
            <Video src={staticFile(`footage/${src}.mp4`)} trimBefore={Math.round(trim * fps)} playbackRate={rate} muted style={media} />
          </Sequence>
        </>
      )}
      {children?.(toBox, k * 2.5)}
    </div>
  );
};

const clipLength = (src: string) => (clips as Record<string, number>)[src] ?? 0;
