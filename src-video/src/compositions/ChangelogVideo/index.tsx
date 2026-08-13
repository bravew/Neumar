import { TransitionSeries } from '@remotion/transitions';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { interpolate, spring } from 'remotion';

import { z } from 'zod';

import { BrandWatermark } from '../../components/BrandWatermark';
import { TextOverlay } from '../../components/TextOverlay';
import { transitions } from '../../components/TransitionPresets';
import { brand, fonts } from '../../theme';

export const changelogSchema = z.object({
  version: z.string(),
  date: z.string(),
  highlights: z.array(
    z.object({
      category: z.string(),
      items: z.array(z.string()),
    }),
  ),
});

type ChangelogProps = z.infer<typeof changelogSchema>;

/**
 * Animated section that uses its own useCurrentFrame() so animations
 * are relative to the enclosing <Sequence>, not the global timeline.
 */
const ChangelogSection: React.FC<{
  category: string;
  items: string[];
}> = ({ category, items }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = spring({
    frame,
    fps,
    config: { damping: 200 },
    durationInFrames: 20,
  });

  return (
    <div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          fontFamily: fonts.heading,
          color: brand.colors.primary,
          marginBottom: 20,
          opacity: titleOpacity,
        }}
      >
        {category}
      </div>

      {items.map((item, itemIdx) => {
        const itemProgress = spring({
          frame: frame - 15 - itemIdx * 15,
          fps,
          config: { damping: 200 },
          durationInFrames: 20,
        });

        return (
          <div
            key={item}
            style={{
              fontSize: 24,
              fontFamily: fonts.body,
              color: brand.colors.text,
              paddingLeft: 24,
              marginBottom: 16,
              opacity: itemProgress,
              transform: `translateX(${interpolate(itemProgress, [0, 1], [20, 0])}px)`,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: brand.colors.primaryDark,
                flexShrink: 0,
              }}
            />
            {item}
          </div>
        );
      })}
    </div>
  );
};

export const ChangelogVideo: React.FC<ChangelogProps> = ({
  version,
  date,
  highlights,
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <TransitionSeries>
        {/* Title card */}
        <TransitionSeries.Sequence durationInFrames={120}>
          <AbsoluteFill
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 20,
            }}
          >
            <TextOverlay
              text={`What's New in v${version}`}
              fontSize={52}
              entrance="scale"
            />
            <TextOverlay
              text={date}
              fontSize={24}
              color={brand.colors.textMuted}
              entrance="fade"
              delay={20}
              y={58}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.slideUp} />

        {/* Changelog items — each section uses Sequence for correct frame */}
        <TransitionSeries.Sequence durationInFrames={900}>
          <AbsoluteFill
            style={{
              padding: '8% 15%',
              display: 'flex',
              flexDirection: 'column',
              gap: 40,
            }}
          >
            {highlights.map((section, sectionIdx) => (
              <Sequence key={section.category} from={sectionIdx * 90}>
                <ChangelogSection
                  category={section.category}
                  items={section.items}
                />
              </Sequence>
            ))}
          </AbsoluteFill>
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* Outro */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <AbsoluteFill
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <TextOverlay
              text={`Update to v${version}`}
              fontSize={42}
              entrance="scale"
            />
            <TextOverlay
              text={`${brand.websiteDisplay}/download`}
              fontSize={24}
              color={brand.colors.primary}
              entrance="fade"
              delay={15}
              y={58}
            />
          </AbsoluteFill>
        </TransitionSeries.Sequence>
      </TransitionSeries>

      <BrandWatermark />
    </AbsoluteFill>
  );
};
