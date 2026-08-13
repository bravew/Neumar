import { Composition, Folder } from 'remotion';

import { ChangelogVideo, changelogSchema } from './compositions/ChangelogVideo';
import { DocDemo, docDemoSchema } from './compositions/DocDemo';
import { FeatureClip, featureClipSchema } from './compositions/FeatureClip';
import { GithubPreview } from './compositions/GithubPreview';
import { HeroDemo } from './compositions/HeroDemo';
import { SocialClip } from './compositions/SocialClip';
import {
  ExplainerLowerThirdsTemplate,
  explainerLowerThirdsTemplateSchema,
} from './templates/ExplainerLowerThirdsTemplate';
import {
  PodcastWaveformTemplate,
  podcastWaveformTemplateSchema,
} from './templates/PodcastWaveformTemplate';
import { brand, timing } from './theme';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main demo video — YouTube / Website hero */}
      <Folder name="Product">
        <Composition
          id="HeroDemo"
          component={HeroDemo}
          durationInFrames={80 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
        />
        <Composition
          id="HeroDemo-4K"
          component={HeroDemo}
          durationInFrames={80 * timing.fps}
          fps={timing.fps}
          width={3840}
          height={2160}
        />
      </Folder>

      {/* Per-feature clips */}
      <Folder name="Features">
        <Composition
          id="FeatureClip"
          component={FeatureClip}
          schema={featureClipSchema}
          durationInFrames={30 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
          defaultProps={{
            featureId: 'agent-chat',
            title: 'Natural Language Agent',
            description: 'Execute complex tasks through conversation',
          }}
        />
      </Folder>

      {/* Documentation demos */}
      <Folder name="Docs">
        <Composition
          id="DocDemo"
          component={DocDemo}
          schema={docDemoSchema}
          durationInFrames={45 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
          defaultProps={{
            id: 'projects.create',
            title: 'Create a scoped project task',
            recordingPath: 'docs/raw/projects/create/source.webm',
            durationMs: 15000,
            fps: timing.fps,
            camera: {
              fps: timing.fps,
              durationMs: 15000,
              zooms: [],
            },
            steps: [],
          }}
        />
      </Folder>

      {/* Social media formats */}
      <Folder name="Social">
        <Composition
          id="SocialClip-Square"
          component={SocialClip}
          durationInFrames={15 * timing.fps}
          fps={timing.fps}
          width={1080}
          height={1080}
        />
        <Composition
          id="SocialClip-Vertical"
          component={SocialClip}
          durationInFrames={15 * timing.fps}
          fps={timing.fps}
          width={1080}
          height={1920}
        />
        <Composition
          id="SocialClip-Landscape"
          component={SocialClip}
          durationInFrames={15 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
        />
      </Folder>

      <Folder name="Video-Mode-Templates">
        <Composition
          id="ExplainerLowerThirdsTemplate"
          component={ExplainerLowerThirdsTemplate}
          schema={explainerLowerThirdsTemplateSchema}
          durationInFrames={42 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
          defaultProps={{
            topic: 'AI workflow automation',
            expert: 'Host',
            takeaway: 'A clear system beats scattered tools.',
            brandColor: brand.colors.primary,
          }}
        />
        <Composition
          id="PodcastWaveformTemplate"
          component={PodcastWaveformTemplate}
          schema={podcastWaveformTemplateSchema}
          durationInFrames={50 * timing.fps}
          fps={timing.fps}
          width={1080}
          height={1920}
          defaultProps={{
            quote: 'The best systems make the next right action obvious.',
            speaker: 'Guest',
            show: 'Podcast',
            brandColor: '#2563eb',
          }}
        />
      </Folder>

      {/* GitHub README */}
      <Folder name="GitHub">
        <Composition
          id="GithubPreview"
          component={GithubPreview}
          durationInFrames={10 * timing.fps}
          fps={timing.fps}
          width={1280}
          height={720}
        />
      </Folder>

      {/* Release changelogs */}
      <Folder name="Changelog">
        <Composition
          id="ChangelogVideo"
          component={ChangelogVideo}
          schema={changelogSchema}
          durationInFrames={45 * timing.fps}
          fps={timing.fps}
          width={1920}
          height={1080}
          defaultProps={{
            version: '26.4.6',
            date: '2026-04-06',
            highlights: [
              {
                category: 'Features',
                items: [
                  'Per-thread workspaces for Slack integration',
                  'File delivery fixes and channel UX improvements',
                ],
              },
              {
                category: 'Improvements',
                items: [
                  'Synced internal documentation',
                  'Memory v3 and agent system updates',
                ],
              },
            ],
          }}
        />
      </Folder>
    </>
  );
};
