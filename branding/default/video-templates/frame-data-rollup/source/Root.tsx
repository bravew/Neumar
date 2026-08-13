import React from 'react';

import { Composition } from 'remotion';
import type { CalculateMetadataFunction } from 'remotion';

import { DataRollup, type DataRollupProps } from './DataRollup';

const SAMPLE: DataRollupProps & {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
} = {
  width: 1920,
  height: 1080,
  fps: 30,
  durationInFrames: 150,
  title: 'This week on GitHub',
  items: [
    { label: 'Mon', value: 1200 },
    { label: 'Tue', value: 2400 },
    { label: 'Wed', value: 1800 },
    { label: 'Thu', value: 4200 },
    { label: 'Fri', value: 3600 },
  ],
};

type DataRollupCompositionProps = DataRollupProps & {
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
};

const calculateMetadata: CalculateMetadataFunction<
  DataRollupCompositionProps
> = ({ props }) => ({
  width: props.width,
  height: props.height,
  fps: props.fps,
  durationInFrames: props.durationInFrames,
});

export const RemotionRoot: React.FC = () => (
  <Composition
    id="DataRollup"
    component={DataRollup}
    defaultProps={SAMPLE}
    calculateMetadata={calculateMetadata}
  />
);
