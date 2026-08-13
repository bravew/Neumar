import { useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { fonts, brand } from '../theme';

type EntranceStyle = 'fade' | 'slide-up' | 'typewriter' | 'scale';

interface TextOverlayProps {
  text: string;
  x?: number;
  y?: number;
  fontSize?: number;
  color?: string;
  entrance?: EntranceStyle;
  delay?: number;
  fontFamily?: string;
  fontWeight?: number;
  maxWidth?: number;
}

export const TextOverlay: React.FC<TextOverlayProps> = ({
  text,
  x = 50,
  y = 50,
  fontSize = 48,
  color = brand.colors.text,
  entrance = 'fade',
  delay = 0,
  fontFamily = fonts.heading,
  fontWeight = 700,
  maxWidth,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: `${x}%`,
    top: `${y}%`,
    transform: 'translate(-50%, -50%)',
    fontSize,
    fontFamily,
    fontWeight,
    color,
    maxWidth,
    textAlign: 'center',
  };

  if (entrance === 'typewriter') {
    const chars = Math.floor(progress * text.length);
    return (
      <div style={baseStyle}>
        {text.slice(0, chars)}
        <span style={{ opacity: frame % 30 < 15 ? 1 : 0 }}>|</span>
      </div>
    );
  }

  let animStyle: React.CSSProperties = {};

  switch (entrance) {
    case 'fade':
      animStyle = { opacity: progress };
      break;
    case 'slide-up':
      animStyle = {
        opacity: progress,
        transform: `translate(-50%, -50%) translateY(${interpolate(progress, [0, 1], [30, 0])}px)`,
      };
      break;
    case 'scale':
      animStyle = {
        opacity: progress,
        transform: `translate(-50%, -50%) scale(${interpolate(progress, [0, 1], [0.8, 1])})`,
      };
      break;
  }

  return <div style={{ ...baseStyle, ...animStyle }}>{text}</div>;
};
