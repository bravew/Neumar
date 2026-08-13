import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, timing } from '../theme';

type Direction = 'top' | 'bottom' | 'left' | 'right';

interface AnnotationProps {
  text: string;
  x: number;
  y: number;
  direction?: Direction;
  delay?: number;
  color?: string;
}

const arrowStyles: Record<Direction, React.CSSProperties> = {
  top: {
    bottom: -8,
    left: '50%',
    transform: 'translateX(-50%) rotate(45deg)',
  },
  bottom: {
    top: -8,
    left: '50%',
    transform: 'translateX(-50%) rotate(45deg)',
  },
  left: {
    right: -8,
    top: '50%',
    transform: 'translateY(-50%) rotate(45deg)',
  },
  right: {
    left: -8,
    top: '50%',
    transform: 'translateY(-50%) rotate(45deg)',
  },
};

export const Annotation: React.FC<AnnotationProps> = ({
  text,
  x,
  y,
  direction = 'top',
  delay = 0,
  color = brand.colors.primary,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const entrance = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 200 },
    durationInFrames: timing.textEntrance,
  });

  const scale = interpolate(entrance, [0, 1], [0.5, 1]);
  const opacity = interpolate(entrance, [0, 1], [0, 1]);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${x}%`,
        top: `${y}%`,
        transform: `scale(${scale})`,
        opacity,
        transformOrigin: direction === 'top' ? 'bottom center' : 'top center',
      }}
    >
      <div
        style={{
          background: color,
          color: '#fff',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 18,
          fontWeight: 600,
          position: 'relative',
          whiteSpace: 'nowrap',
        }}
      >
        {text}
        <div
          style={{
            position: 'absolute',
            width: 16,
            height: 16,
            background: color,
            ...arrowStyles[direction],
          }}
        />
      </div>
    </div>
  );
};
