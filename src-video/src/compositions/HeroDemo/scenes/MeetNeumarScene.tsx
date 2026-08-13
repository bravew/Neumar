import { AbsoluteFill, Sequence } from 'remotion';

import {
  CursorAnimation,
  type CursorPoint,
} from '../../../components/CursorAnimation';
import { DeviceFrame } from '../../../components/DeviceFrame';
import { TextOverlay } from '../../../components/TextOverlay';
import { ZoomEffect } from '../../../components/ZoomEffect';
import { brand } from '../../../theme';

const CURSOR_POINTS: CursorPoint[] = [
  { x: 960, y: 900 },
  { x: 960, y: 950, click: true },
];

export const MeetNeumarScene: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: brand.colors.background }}>
      <TextOverlay
        text="One app. Every AI agent."
        y={8}
        fontSize={42}
        fontWeight={700}
        entrance="slide-up"
      />

      <Sequence from={20}>
        <div
          style={{
            position: 'absolute',
            top: '15%',
            left: '10%',
            right: '10%',
            bottom: '5%',
          }}
        >
          <ZoomEffect
            targetX={0.5}
            targetY={0.85}
            zoomLevel={1.8}
            startFrame={120}
            durationInFrames={30}
            holdFrames={90}
          >
            <DeviceFrame screenshot="home-with-tasks.png" type="desktop" />
          </ZoomEffect>
        </div>
      </Sequence>

      <Sequence from={150}>
        <CursorAnimation
          startFrame={0}
          points={CURSOR_POINTS}
          framesPerSegment={20}
        />
      </Sequence>

      <Sequence from={180}>
        <TextOverlay
          text="Research competitor pricing and create a summary report"
          y={92}
          x={50}
          fontSize={20}
          entrance="typewriter"
          fontFamily="JetBrains Mono"
          fontWeight={400}
          color={brand.colors.textMuted}
        />
      </Sequence>
    </AbsoluteFill>
  );
};
