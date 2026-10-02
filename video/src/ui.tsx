// The video's layout: one short headline at the top, and the product filling the rest of the frame, cropped to
// the one thing that matters and pushed in on it slowly.
import { Video } from '@remotion/media';
import type React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, SANS, SHADOW } from './brand';

const ease = Easing.bezier(0.33, 0, 0.2, 1);
/** 0 to 1 between two frames, eased, clamped. */
export const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });

/** The product's box: 1760 × 810, three-quarters of the frame's height. */
export const BOX = { x: 80, y: 240, w: 1760, h: 810 };

export const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ background: C.canvas, fontFamily: SANS, color: C.ink }}>{children}</AbsoluteFill>
);

/**
 * The scene's headline. Several lines take turns: each [text, from frame] fades in where the one before fades
 * out, so the top of the frame says one thing at a time.
 */
export const Headline: React.FC<{ lines: [string, number][]; size?: number }> = ({ lines, size = 68 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: BOX.x, right: BOX.x, top: 40, height: 180 }}>
      {lines.map(([text, from], i) => {
        const next = lines[i + 1]?.[1];
        const opacity = progress(frame, from, from + 14) * (next === undefined ? 1 : 1 - progress(frame, next - 10, next));
        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              fontSize: size,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
              textWrap: 'balance',
              opacity,
              translate: `0px ${(1 - progress(frame, from, from + 14)) * 10}px`,
            }}
          >
            {text}
          </div>
        );
      })}
    </div>
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
 * The product, filling a box: a clip (public/footage/<src>.mp4) or a still (<src>.jpg), showing `from` and
 * moving to `to` between frames `push[0]` and `push[1]` (a slow push in). A clip plays from `trim` seconds at
 * `rate` times its speed, then holds its last frame.
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
}> = ({ src, still, from, to = from, push = [0, 1], trim = 0, rate = 1, box = BOX, style, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
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
        background: C.surface,
        boxShadow: SHADOW,
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

import clips from '../public/footage/clips.json';
const clipLength = (src: string) => (clips as Record<string, number>)[src] ?? 0;

/** The stacked layout: the headline, and the product below it. */
export const Stacked: React.FC<{ lines: [string, number][]; children: React.ReactNode }> = ({ lines, children }) => (
  <Scene>
    <Headline lines={lines} />
    <div style={{ position: 'absolute', left: BOX.x, top: BOX.y }}>{children}</div>
  </Scene>
);
