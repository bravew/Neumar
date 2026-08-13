import { TransitionSeries } from '@remotion/transitions';
import { AbsoluteFill, Sequence } from 'remotion';

import { BrandWatermark } from '../../components/BrandWatermark';
import { transitions } from '../../components/TransitionPresets';
import { brand } from '../../theme';
import { AgentActionScene } from './scenes/AgentActionScene';
import { FeaturesMontageScene } from './scenes/FeaturesMontageScene';
import { IntroScene } from './scenes/IntroScene';
import { MeetNeumarScene } from './scenes/MeetNeumarScene';
import { OutroScene } from './scenes/OutroScene';
import { PlatformsScene } from './scenes/PlatformsScene';
import { ProblemScene } from './scenes/ProblemScene';

/**
 * Hero Demo — 80s product overview video.
 *
 * Story arc: Intro → Problem → Meet Neumar → Agent in Action →
 *            Features Montage → Platforms → CTA/Outro
 *
 * Audio (voiceover + BGM) should be added via <Audio> + <Sequence>
 * once voiceover files are generated. See generate-voiceover.ts.
 */
export const HeroDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      {/* Scene sequence with transitions */}
      <TransitionSeries>
        {/* Scene 1: Intro — 5s */}
        <TransitionSeries.Sequence durationInFrames={150}>
          <IntroScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* Scene 2: The Problem — 7s */}
        <TransitionSeries.Sequence durationInFrames={210}>
          <ProblemScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.slideRight} />

        {/* Scene 3: Meet Neumar — 10s */}
        <TransitionSeries.Sequence durationInFrames={300}>
          <MeetNeumarScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* Scene 4: Agent in Action — 20s */}
        <TransitionSeries.Sequence durationInFrames={600}>
          <AgentActionScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.slideUp} />

        {/* Scene 5: Features Montage — 18s */}
        <TransitionSeries.Sequence durationInFrames={540}>
          <FeaturesMontageScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* Scene 6: Platforms — 10s */}
        <TransitionSeries.Sequence durationInFrames={300}>
          <PlatformsScene />
        </TransitionSeries.Sequence>

        <TransitionSeries.Transition {...transitions.crossfade} />

        {/* Scene 7: Outro — 10s */}
        <TransitionSeries.Sequence durationInFrames={300}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>

      {/* Persistent watermark (appears after intro) */}
      <Sequence from={150}>
        <BrandWatermark />
      </Sequence>
    </AbsoluteFill>
  );
};
