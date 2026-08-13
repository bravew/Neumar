import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../../theme';

const platforms = [
  { name: 'macOS', icon: '\uD83C\uDF4E' },
  { name: 'Windows', icon: '\u229E' },
  { name: 'Linux', icon: '\uD83D\uDC27' },
];

export const PlatformsScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  const subtitleProgress = spring({
    frame: frame - 60,
    fps,
    config: { damping: 200 },
    durationInFrames: 25,
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: brand.colors.background,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 50,
      }}
    >
      {/* Platform icons */}
      <div style={{ display: 'flex', gap: 60 }}>
        {platforms.map((platform, i) => {
          const itemProgress = spring({
            frame: frame - 15 - i * 10,
            fps,
            config: { damping: 12, stiffness: 180 },
            durationInFrames: 25,
          });

          return (
            <div
              key={platform.name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                opacity: itemProgress,
                transform: `scale(${interpolate(itemProgress, [0, 1], [0.7, 1])})`,
              }}
            >
              <div
                style={{
                  width: 100,
                  height: 100,
                  borderRadius: 24,
                  background: brand.colors.surface,
                  border: `1px solid ${brand.colors.surfaceBorder}`,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  fontSize: 48,
                }}
              >
                {platform.icon}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontFamily: fonts.body,
                  color: brand.colors.textMuted,
                  fontWeight: 500,
                }}
              >
                {platform.name}
              </div>
            </div>
          );
        })}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 42,
          fontWeight: 700,
          fontFamily: fonts.heading,
          color: brand.colors.text,
          textAlign: 'center',
          opacity: titleProgress,
          transform: `translateY(${interpolate(titleProgress, [0, 1], [20, 0])}px)`,
        }}
      >
        Desktop power. Cloud convenience.
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: 22,
          fontFamily: fonts.body,
          color: brand.colors.textMuted,
          textAlign: 'center',
          opacity: subtitleProgress,
        }}
      >
        Desktop app + Web dashboard, seamlessly synced
      </div>
    </AbsoluteFill>
  );
};
