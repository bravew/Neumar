import {
  AbsoluteFill,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../../theme';

export const IntroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({
    frame,
    fps,
    config: { damping: 15 },
    durationInFrames: 40,
  });
  const logoOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const taglineProgress = spring({
    frame: frame - 40,
    fps,
    config: { damping: 200 },
    durationInFrames: 30,
  });
  const taglineY = interpolate(taglineProgress, [0, 1], [20, 0]);
  const taglineOpacity = interpolate(taglineProgress, [0, 1], [0, 1]);

  const gradientShift = interpolate(frame, [0, 150], [0, 30]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(
          ellipse at ${50 + gradientShift * 0.1}% ${50 + gradientShift * 0.05}%,
          ${brand.colors.primary}20 0%,
          ${brand.colors.background} 70%
        )`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 30,
      }}
    >
      <div
        style={{
          transform: `scale(${interpolate(logoScale, [0, 1], [0.8, 1])})`,
          opacity: logoOpacity,
        }}
      >
        <Img
          src={staticFile('brand/app-icon.png')}
          style={{ width: 120, height: 120 }}
        />
      </div>

      <div
        style={{
          fontSize: 72,
          fontWeight: 800,
          fontFamily: fonts.heading,
          color: brand.colors.text,
          opacity: logoOpacity,
          letterSpacing: -1,
        }}
      >
        {brand.name}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 400,
          fontFamily: fonts.body,
          color: brand.colors.textMuted,
          transform: `translateY(${taglineY}px)`,
          opacity: taglineOpacity,
          letterSpacing: 2,
        }}
      >
        {brand.tagline}
      </div>
    </AbsoluteFill>
  );
};
