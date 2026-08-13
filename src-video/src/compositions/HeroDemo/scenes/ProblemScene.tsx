import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { interpolate, spring } from 'remotion';

import { brand, fonts } from '../../../theme';

const painPoints = [
  { icon: '>_', label: 'Terminal commands' },
  { icon: '{}', label: 'API configurations' },
  { icon: '...', label: 'Context switching' },
  { icon: 'x10', label: 'Ten different tools' },
];

export const ProblemScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleProgress = spring({
    frame,
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
        padding: '0 10%',
        gap: 60,
      }}
    >
      <div
        style={{
          fontSize: 42,
          fontWeight: 700,
          fontFamily: fonts.heading,
          color: brand.colors.text,
          textAlign: 'center',
          opacity: titleProgress,
          transform: `translateY(${interpolate(titleProgress, [0, 1], [20, 0])}px)`,
          lineHeight: 1.3,
        }}
      >
        AI tools are powerful.
        <br />
        <span style={{ color: brand.colors.textMuted }}>
          Managing them shouldn't be a job.
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 40,
          justifyContent: 'center',
        }}
      >
        {painPoints.map((point, i) => {
          const itemProgress = spring({
            frame: frame - 30 - i * 12,
            fps,
            config: { damping: 15, stiffness: 180 },
            durationInFrames: 20,
          });

          return (
            <div
              key={point.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 16,
                opacity: itemProgress,
                transform: `translateY(${interpolate(itemProgress, [0, 1], [30, 0])}px)`,
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 16,
                  background: brand.colors.surface,
                  border: `1px solid ${brand.colors.surfaceBorder}`,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  fontSize: 28,
                  fontFamily: fonts.mono,
                  color: '#ff6b6b',
                }}
              >
                {point.icon}
              </div>
              <div
                style={{
                  fontSize: 16,
                  fontFamily: fonts.body,
                  color: brand.colors.textMuted,
                }}
              >
                {point.label}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
