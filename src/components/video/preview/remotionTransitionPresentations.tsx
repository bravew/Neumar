import { type CSSProperties, useMemo } from 'react';

import { durationMsToFrames, resolveTransitionParams } from '@neumar/video-ir';
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
  TransitionTiming,
} from '@remotion/transitions';
import { linearTiming } from '@remotion/transitions';
import { dissolve } from '@remotion/transitions/dissolve';
import { fade } from '@remotion/transitions/fade';
import { flip } from '@remotion/transitions/flip';
import { iris } from '@remotion/transitions/iris';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { zoomBlur } from '@remotion/transitions/zoom-blur';
import { zoomInOut } from '@remotion/transitions/zoom-in-out';
import { AbsoluteFill, Easing } from 'remotion';

import {
  normalizeVideoTransition,
  videoTransitionRegistryEntry,
  type VideoTimelineTransition,
  type VideoTransitionDirection,
} from '@/shared/types/video';

import { remotionClockWipePresentation } from './remotionClockWipePresentation';

interface TransitionClip {
  durationInFrames: number;
  fromFrame: number;
  transitionToNext?: VideoTimelineTransition;
}

interface CanvasSize {
  width: number;
  height: number;
}

type AnyTransitionPresentation = TransitionPresentation<
  Record<string, unknown>
>;
type DirectionalPresentationProps = {
  direction: VideoTransitionDirection;
  mode: 'cover' | 'reveal';
};
type CubePresentationProps = {
  direction: VideoTransitionDirection;
};

const SUBTLE_EASING = Easing.inOut(Easing.ease);
const MOVEMENT_EASING = Easing.out(Easing.cubic);
const STYLIZED_EASING = Easing.inOut(Easing.cubic);

export function transitionFramesForClip(
  clip: TransitionClip,
  nextClip: TransitionClip | undefined,
  fps: number,
): number {
  const transition = normalizeVideoTransition(clip.transitionToNext);
  if (!nextClip || transition.kind === 'cut') return 0;
  const contiguousGap =
    nextClip.fromFrame - (clip.fromFrame + clip.durationInFrames);
  if (Math.abs(contiguousGap) > 1) return 0;
  const entry = videoTransitionRegistryEntry(transition.kind);
  const requestedDurationMs = Math.min(
    transition.durationMs ?? entry.defaultDurationMs,
    entry.maxDurationMs,
  );
  const requestedFrames = Math.max(
    1,
    durationMsToFrames(requestedDurationMs, fps),
  );
  return Math.max(
    1,
    Math.min(
      requestedFrames,
      Math.floor(clip.durationInFrames / 2),
      Math.floor(nextClip.durationInFrames / 2),
    ),
  );
}

export function transitionPresentation(
  transition: VideoTimelineTransition | undefined,
  size: CanvasSize,
): AnyTransitionPresentation {
  const spec = normalizeVideoTransition(transition);
  if (spec.kind === 'slide') {
    return asAnyTransitionPresentation(
      slide({
        direction: spec.direction ?? 'from-right',
      }),
    );
  }
  if (spec.kind === 'wipe') {
    return asAnyTransitionPresentation(
      wipe({
        direction: spec.direction ?? 'from-left',
      }),
    );
  }
  if (spec.kind === 'soft-wipe') {
    return asAnyTransitionPresentation(wipe({ direction: 'from-left' }));
  }
  if (spec.kind === 'iris') {
    return asAnyTransitionPresentation(iris(size));
  }
  if (spec.kind === 'polygon-iris') {
    return asAnyTransitionPresentation(iris(size));
  }
  if (spec.kind === 'cover') {
    return cover(spec.direction ?? 'from-left');
  }
  if (spec.kind === 'reveal') {
    return reveal(spec.direction ?? 'from-left');
  }
  if (spec.kind === 'flip') {
    return asAnyTransitionPresentation(
      flip({
        direction: spec.direction ?? 'from-right',
      }),
    );
  }
  if (spec.kind === 'clock-wipe') {
    const params = resolveTransitionParams(
      videoTransitionRegistryEntry('clock-wipe'),
      spec.params,
    ).values;
    return asAnyTransitionPresentation(
      remotionClockWipePresentation({
        center: vec2Param(params.center, [0.5, 0.5]),
        counterClockwise: params.sweep === 'counterclockwise',
        edgeColor: vec4Param(params.edgeColor, [1, 1, 1, 1]),
        feather: numberParam(params.feather, 0.015),
        height: size.height,
        sectors: numberParam(params.sectors, 1),
        startAngleDeg: numberParam(params.startAngle, 90),
        width: size.width,
      }),
    );
  }
  if (spec.kind === 'cube') {
    return cube(spec.direction ?? 'from-right');
  }
  if (spec.kind === 'zoom-blur') {
    return asAnyTransitionPresentation(zoomBlur({ rotation: 0 }));
  }
  if (spec.kind === 'zoom-in-out') {
    return asAnyTransitionPresentation(zoomInOut({}));
  }
  if (spec.kind === 'dissolve' || spec.kind === 'pixelize') {
    return asAnyTransitionPresentation(dissolve({}));
  }
  return asAnyTransitionPresentation(fade());
}

export function transitionTiming(
  transition: VideoTimelineTransition | undefined,
  durationInFrames: number,
): TransitionTiming {
  const spec = normalizeVideoTransition(transition);
  return linearTiming({
    durationInFrames,
    easing: easingForTransitionKind(spec.kind),
  });
}

function easingForTransitionKind(
  kind: ReturnType<typeof normalizeVideoTransition>['kind'],
) {
  if (kind === 'fade' || kind === 'dissolve') return SUBTLE_EASING;
  if (
    kind === 'flip' ||
    kind === 'cube' ||
    kind === 'pixelize' ||
    kind === 'zoom-blur' ||
    kind === 'zoom-in-out'
  ) {
    return STYLIZED_EASING;
  }
  if (kind === 'cut') return Easing.linear;
  return MOVEMENT_EASING;
}

function cover(direction: VideoTransitionDirection): AnyTransitionPresentation {
  return {
    component: DirectionalPresentation,
    props: { direction, mode: 'cover' },
  } as unknown as AnyTransitionPresentation;
}

function reveal(
  direction: VideoTransitionDirection,
): AnyTransitionPresentation {
  return {
    component: DirectionalPresentation,
    props: { direction, mode: 'reveal' },
  } as unknown as AnyTransitionPresentation;
}

function cube(direction: VideoTransitionDirection): AnyTransitionPresentation {
  return {
    component: CubePresentation,
    props: { direction },
  } as unknown as AnyTransitionPresentation;
}

function asAnyTransitionPresentation<Props extends Record<string, unknown>>(
  presentation: TransitionPresentation<Props>,
): AnyTransitionPresentation {
  return presentation as unknown as AnyTransitionPresentation;
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function vec2Param(
  value: unknown,
  fallback: readonly [number, number],
): readonly [number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0], value[1]]
    : fallback;
}

function vec4Param(
  value: unknown,
  fallback: readonly [number, number, number, number],
): readonly [number, number, number, number] {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
    ? [value[0], value[1], value[2], value[3]]
    : fallback;
}

function DirectionalPresentation({
  children,
  presentationDirection,
  presentationProgress,
  passedProps,
}: TransitionPresentationComponentProps<DirectionalPresentationProps>) {
  const style = useMemo(() => {
    const shouldMove =
      passedProps.mode === 'cover'
        ? presentationDirection === 'entering'
        : presentationDirection === 'exiting';
    return {
      width: '100%',
      height: '100%',
      transform: shouldMove
        ? directionTransform(
            passedProps.direction,
            passedProps.mode === 'cover'
              ? 1 - presentationProgress
              : presentationProgress,
          )
        : undefined,
    } satisfies CSSProperties;
  }, [
    passedProps.direction,
    passedProps.mode,
    presentationDirection,
    presentationProgress,
  ]);

  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

function CubePresentation({
  children,
  presentationDirection,
  presentationProgress,
  passedProps,
}: TransitionPresentationComponentProps<CubePresentationProps>) {
  const style = useMemo(() => {
    const entering = presentationDirection === 'entering';
    const progress = entering ? 1 - presentationProgress : presentationProgress;
    return {
      width: '100%',
      height: '100%',
      transformOrigin: cubeTransformOrigin(passedProps.direction, entering),
      transform: `perspective(1200px) ${cubeRotate(
        passedProps.direction,
        progress,
        entering,
      )}`,
      backfaceVisibility: 'hidden',
    } satisfies CSSProperties;
  }, [passedProps.direction, presentationDirection, presentationProgress]);

  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

function directionTransform(
  direction: VideoTransitionDirection,
  progress: number,
): string {
  if (direction === 'from-left') return `translateX(${-100 * progress}%)`;
  if (direction === 'from-right') return `translateX(${100 * progress}%)`;
  if (direction === 'from-top') return `translateY(${-100 * progress}%)`;
  return `translateY(${100 * progress}%)`;
}

function cubeTransformOrigin(
  direction: VideoTransitionDirection,
  entering: boolean,
): string {
  if (direction === 'from-left')
    return entering ? 'left center' : 'right center';
  if (direction === 'from-right')
    return entering ? 'right center' : 'left center';
  if (direction === 'from-top')
    return entering ? 'center top' : 'center bottom';
  return entering ? 'center bottom' : 'center top';
}

function cubeRotate(
  direction: VideoTransitionDirection,
  progress: number,
  entering: boolean,
): string {
  const sign = entering ? -1 : 1;
  if (direction === 'from-left') return `rotateY(${sign * 90 * progress}deg)`;
  if (direction === 'from-right') return `rotateY(${-sign * 90 * progress}deg)`;
  if (direction === 'from-top') return `rotateX(${-sign * 90 * progress}deg)`;
  return `rotateX(${sign * 90 * progress}deg)`;
}
