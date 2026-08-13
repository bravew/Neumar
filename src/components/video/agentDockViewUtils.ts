import type { VideoAspectRatio } from '@/shared/types/video';

import type { AgentActionName } from './useAgentDock';

const MIN_DOCK_WIDTH = 380;
const MAX_DOCK_WIDTH = 640;

export function buildAgentDockSuggestions(
  labels: { regenerate: string; addTransition: string; generateMusic: string },
  sceneIndex: number,
  aspectRatio: VideoAspectRatio,
) {
  return [
    labels.regenerate.replace('{scene}', String(sceneIndex)),
    labels.addTransition,
    labels.generateMusic.replace('{aspect}', aspectRatio),
  ];
}

export function agentActionTitle(
  name: AgentActionName,
  labels: Record<AgentActionName, string>,
): string {
  return labels[name] ?? name;
}

export function clampAgentDockWidth(width: number): number {
  return Math.min(MAX_DOCK_WIDTH, Math.max(MIN_DOCK_WIDTH, width));
}
