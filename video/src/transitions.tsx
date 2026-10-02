// How one scene becomes the next: a zoom through (the old scene grows and fades as the new one settles in),
// a slide, or a fade. Never a hard cut.
import { fade } from '@remotion/transitions/fade';
import { slide } from '@remotion/transitions/slide';
import { linearTiming } from '@remotion/transitions';
import type { TransitionPresentation, TransitionPresentationComponentProps } from '@remotion/transitions';
import { AbsoluteFill, Easing } from 'remotion';

type None = Record<string, never>;
const ZoomThrough: React.FC<TransitionPresentationComponentProps<None>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
}) => {
  const entering = presentationDirection === 'entering';
  return (
    <AbsoluteFill style={{ scale: String(entering ? 0.94 + 0.06 * p : 1 + 0.3 * p), opacity: entering ? p : 1 - p }}>
      {children}
    </AbsoluteFill>
  );
};
const zoomThrough = (): TransitionPresentation<None> => ({ component: ZoomThrough, props: {} });

/** Frames each transition takes. */
export const T = 15;
export const timing = linearTiming({ durationInFrames: T, easing: Easing.bezier(0.33, 0, 0.2, 1) });
export const through = { zoom: zoomThrough(), slide: slide({ direction: 'from-right' }), fade: fade() };
