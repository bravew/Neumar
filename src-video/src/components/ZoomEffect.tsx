import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

interface ZoomEffectProps {
  children: React.ReactNode;
  targetX: number;
  targetY: number;
  zoomLevel: number;
  startFrame: number;
  durationInFrames: number;
  holdFrames?: number;
}

export const ZoomEffect: React.FC<ZoomEffectProps> = ({
  children,
  targetX,
  targetY,
  zoomLevel,
  startFrame,
  durationInFrames,
  holdFrames = 60,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const zoomIn = spring({
    frame: frame - startFrame,
    fps,
    config: { damping: 200 },
    durationInFrames,
  });

  const zoomOut = spring({
    frame: frame - startFrame - durationInFrames - holdFrames,
    fps,
    config: { damping: 200 },
    durationInFrames,
  });

  const progress = zoomIn - zoomOut;
  const scale = interpolate(progress, [0, 1], [1, zoomLevel]);
  const translateX = interpolate(
    progress,
    [0, 1],
    [0, -(targetX - 0.5) * width * (zoomLevel - 1)],
  );
  const translateY = interpolate(
    progress,
    [0, 1],
    [0, -(targetY - 0.5) * height * (zoomLevel - 1)],
  );

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        transform: `scale(${scale}) translate(${translateX}px, ${translateY}px)`,
        transformOrigin: 'center center',
      }}
    >
      {children}
    </div>
  );
};
