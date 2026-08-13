import { Img, staticFile, useCurrentFrame } from 'remotion';
import { interpolate } from 'remotion';

import { brand } from '../theme';

interface BrandWatermarkProps {
  position?: 'bottom-left' | 'bottom-right';
  size?: number;
  opacity?: number;
}

export const BrandWatermark: React.FC<BrandWatermarkProps> = ({
  position = 'bottom-right',
  size = 40,
  opacity = 0.6,
}) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 20], [0, opacity], {
    extrapolateRight: 'clamp',
  });

  const posStyle =
    position === 'bottom-right'
      ? { bottom: 30, right: 30 }
      : { bottom: 30, left: 30 };

  return (
    <div
      style={{
        position: 'absolute',
        ...posStyle,
        opacity: fadeIn,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Img
        src={staticFile(brand.logo.iconPath)}
        style={{ width: size, height: size }}
      />
      <span
        style={{
          color: brand.colors.textMuted,
          fontSize: size * 0.45,
          fontWeight: 600,
          letterSpacing: 1,
        }}
      >
        {brand.name}
      </span>
    </div>
  );
};
