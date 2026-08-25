import type {
  VideoEngineOption,
  VideoEngineUnavailableReason,
} from '@/shared/video/useVideoEngines';

// Phase B packaged-runtime policy: Neuma requires the HyperFrames CLI on PATH
// rather than bundling it (the CLI drags its own Chrome download). The policy
// obliges a doctor-style first-run surface, so the typed probe reason has to
// become an actionable install step instead of a raw render error.

export interface EngineSetupStep {
  /** Shell command the user runs to fix this. Never localized. */
  command: string;
  /** Optional docs URL for the step. */
  docsUrl?: string;
}

const HYPERFRAMES_DOCS = 'https://hyperframes.dev/docs/install';
const PLAYWRIGHT_DOCS = 'https://playwright.dev/docs/browsers';

const GUIDANCE: Record<
  string,
  Partial<Record<VideoEngineUnavailableReason, EngineSetupStep>>
> = {
  hyperframes: {
    'not-found': {
      command: 'npm install -g hyperframes@0.8.7',
      docsUrl: HYPERFRAMES_DOCS,
    },
    'version-too-old': {
      command: 'npm install -g hyperframes@0.8.7',
      docsUrl: HYPERFRAMES_DOCS,
    },
    'browser-missing': {
      command: 'hyperframes browser ensure',
      docsUrl: HYPERFRAMES_DOCS,
    },
  },
  html: {
    'browser-missing': {
      command: 'npx playwright install chromium',
      docsUrl: PLAYWRIGHT_DOCS,
    },
    'not-found': {
      command: 'npx playwright install chromium',
      docsUrl: PLAYWRIGHT_DOCS,
    },
  },
  remotion: {
    'not-found': { command: 'pnpm install' },
    'browser-missing': { command: 'npx remotion browser ensure' },
  },
};

export function engineSetupStep(
  engine: Pick<VideoEngineOption, 'id' | 'unavailableReason'>,
): EngineSetupStep | undefined {
  if (!engine.unavailableReason) return undefined;
  return GUIDANCE[engine.id]?.[engine.unavailableReason];
}
