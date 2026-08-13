import {
  AbsoluteFill,
  OffthreadVideo,
  Sequence,
  staticFile,
  useVideoConfig,
} from 'remotion';

import { Annotation } from '../../../components/Annotation';
import { MacOSTitleBar } from '../../../components/MacOSTitleBar';
import { ZoomEffect } from '../../../components/ZoomEffect';

export const AgentActionScene: React.FC = () => {
  const { fps } = useVideoConfig();

  const recordingContent = (
    <div
      style={{
        padding: '3% 8%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div
        style={{
          background: '#2a2a2a',
          borderRadius: 16,
          padding: 8,
          width: '100%',
        }}
      >
        <MacOSTitleBar />
        <OffthreadVideo
          src={staticFile('recordings/task-creation-flow.webm')}
          startFrom={0}
          style={{ width: '100%', borderRadius: 8, display: 'block' }}
        />
      </div>
    </div>
  );

  return (
    <AbsoluteFill>
      {/* Recording with zoom effect applied at 3s mark */}
      <Sequence from={0} durationInFrames={3 * fps}>
        {recordingContent}
      </Sequence>

      <Sequence from={3 * fps} durationInFrames={4 * fps}>
        <ZoomEffect
          targetX={0.5}
          targetY={0.85}
          zoomLevel={2.0}
          startFrame={0}
          durationInFrames={fps}
          holdFrames={2 * fps}
        >
          {recordingContent}
        </ZoomEffect>
      </Sequence>

      <Sequence from={7 * fps}>{recordingContent}</Sequence>

      {/* Annotations */}
      <Sequence from={2 * fps}>
        <Annotation text="Type your task here" x={50} y={85} direction="top" />
      </Sequence>

      <Sequence from={5 * fps}>
        <Annotation
          text="Agent starts executing"
          x={30}
          y={40}
          direction="right"
        />
      </Sequence>

      <Sequence from={10 * fps}>
        <Annotation
          text="Results appear in real-time"
          x={70}
          y={50}
          direction="left"
        />
      </Sequence>

      <Sequence from={15 * fps}>
        <Annotation
          text="Artifacts preview instantly"
          x={75}
          y={30}
          direction="bottom"
        />
      </Sequence>
    </AbsoluteFill>
  );
};
