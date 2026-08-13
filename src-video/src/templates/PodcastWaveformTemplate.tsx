import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import { z } from 'zod';

import { brand, fonts } from '../theme';

export const podcastWaveformTemplateSchema = z.object({
  quote: z
    .string()
    .default('The best systems make the next right action obvious.'),
  speaker: z.string().default('Guest'),
  show: z.string().default('Podcast'),
  brandColor: z.string().default('#2563eb'),
});

export const PodcastWaveformTemplate: React.FC<
  z.infer<typeof podcastWaveformTemplateSchema>
> = ({ quote, speaker, show, brandColor }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleIn = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 95 },
  });
  const quoteOpacity = interpolate(frame, [72, 100], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(180deg, #050816 0%, #111827 72%, ${brandColor} 170%)`,
        color: brand.colors.text,
        fontFamily: fonts.heading,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 64,
          borderRadius: 44,
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid rgba(255,255,255,0.14)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 150,
          left: 92,
          right: 92,
          textAlign: 'center',
          transform: `translateY(${(1 - titleIn) * 28}px)`,
          opacity: titleIn,
        }}
      >
        <div
          style={{
            color: brandColor,
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: 0,
            textTransform: 'uppercase',
          }}
        >
          {show}
        </div>
        <div
          style={{
            marginTop: 18,
            fontSize: 76,
            fontWeight: 850,
            lineHeight: 0.98,
            letterSpacing: 0,
          }}
        >
          {speaker}
        </div>
      </div>

      <div
        style={{
          position: 'absolute',
          left: 108,
          right: 108,
          top: 470,
          opacity: quoteOpacity,
          fontSize: 54,
          fontWeight: 780,
          lineHeight: 1.14,
          textAlign: 'center',
        }}
      >
        "{quote}"
      </div>

      <div
        style={{
          position: 'absolute',
          left: 108,
          right: 108,
          bottom: 245,
          height: 180,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        {Array.from({ length: 42 }).map((_, index) => {
          const phase = frame / 7 + index * 0.8;
          const height = 34 + Math.abs(Math.sin(phase)) * 118;
          return (
            <div
              key={index}
              style={{
                width: 9,
                height,
                borderRadius: 999,
                background:
                  index % 5 === 0 ? brandColor : 'rgba(255,255,255,0.72)',
                opacity: 0.72 + Math.abs(Math.cos(phase)) * 0.28,
              }}
            />
          );
        })}
      </div>

      <div
        style={{
          position: 'absolute',
          left: 108,
          right: 108,
          bottom: 135,
          height: 4,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.16)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.min(100, (frame / (fps * 50)) * 100)}%`,
            height: '100%',
            background: brandColor,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
