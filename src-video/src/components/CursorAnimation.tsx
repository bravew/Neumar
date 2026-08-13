import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

export interface CursorPoint {
  x: number;
  y: number;
  click?: boolean;
  holdFrames?: number;
}

interface CursorAnimationProps {
  points: CursorPoint[];
  startFrame: number;
  framesPerSegment?: number;
}

export const CursorAnimation: React.FC<CursorAnimationProps> = ({
  points,
  startFrame,
  framesPerSegment = 30,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const relFrame = frame - startFrame;

  if (relFrame < 0 || points.length < 1) return null;

  let accumulated = 0;
  let segmentIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const segDuration = framesPerSegment + (points[i].holdFrames ?? 0);
    if (relFrame < accumulated + segDuration) {
      segmentIndex = i;
      break;
    }
    accumulated += segDuration;
    segmentIndex = i + 1;
  }

  const currentPoint = points[Math.min(segmentIndex, points.length - 1)];
  const nextPoint = points[Math.min(segmentIndex + 1, points.length - 1)];
  const segmentProgress = spring({
    frame: relFrame - accumulated,
    fps,
    config: { damping: 20, stiffness: 150 },
    durationInFrames: framesPerSegment,
  });

  const x = interpolate(segmentProgress, [0, 1], [currentPoint.x, nextPoint.x]);
  const y = interpolate(segmentProgress, [0, 1], [currentPoint.y, nextPoint.y]);

  const isClicking =
    currentPoint.click && relFrame - accumulated > framesPerSegment - 5;
  const clickScale = isClicking ? 0.85 : 1;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${clickScale})`,
        pointerEvents: 'none',
        zIndex: 1000,
      }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="M5 3L19 12L12 13L9 20L5 3Z"
          fill="white"
          stroke="black"
          strokeWidth="1.5"
        />
      </svg>
      {isClicking && (
        <div
          style={{
            position: 'absolute',
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '2px solid white',
            opacity: 0.5,
            top: -3,
            left: -3,
          }}
        />
      )}
    </div>
  );
};
