import {
  FileText,
  GalleryVerticalEnd,
  Images,
  LayoutTemplate,
  MonitorSmartphone,
  PanelsTopLeft,
  Presentation,
  type LucideIcon,
} from 'lucide-react';

import type {
  DesignProjectIntent,
  DesignSurface,
} from '@/shared/types/design-mode';

export const DESIGN_MODE_ENABLED =
  import.meta.env.VITE_DESIGN_MODE_ENABLED !== 'false';

/**
 * Agentic surfaces that route through the conversational chat loop (Fix-sync
 * Phase 02) rather than the one-shot media dispatcher. Mirrors the backend
 * `isChatSurface` in `src-api/.../design-mode/chat.ts`.
 */
const CHAT_SURFACES = new Set<DesignSurface>([
  'prototype',
  'template',
  'deck',
  'document',
  'campaign',
]);

export function isDesignChatSurface(surface: DesignSurface): boolean {
  return CHAT_SURFACES.has(surface);
}

export const SURFACE_OPTIONS: Array<{
  id: DesignSurface | 'other' | 'media';
  label: string;
  icon: LucideIcon;
}> = [
  { id: 'document', label: 'Document', icon: FileText },
  { id: 'prototype', label: 'Prototype', icon: MonitorSmartphone },
  { id: 'deck', label: 'Slide deck', icon: Presentation },
  { id: 'template', label: 'From template', icon: LayoutTemplate },
  { id: 'media', label: 'Media', icon: Images },
  { id: 'campaign', label: 'Campaign', icon: PanelsTopLeft },
  { id: 'other', label: 'Other', icon: GalleryVerticalEnd },
];

export function surfaceLabel(surface: string) {
  return SURFACE_OPTIONS.find((item) => item.id === surface)?.label ?? surface;
}

export function localizedSurfaceLabel(
  surface: DesignSurface | 'other' | string,
  labels: Record<string, string>,
) {
  return labels[surface] ?? surfaceLabel(surface);
}

export function localizedIntentLabel(
  intent: DesignProjectIntent | string | undefined,
  labels: Record<string, string>,
) {
  return intent ? (labels[intent] ?? intent) : labels.other;
}

export function categoryChipForProject(
  project: { intent?: DesignProjectIntent; surface: DesignSurface },
  labels: Record<string, string>,
) {
  if (
    project.intent === 'landing-page' ||
    project.intent === 'app-screen' ||
    project.intent === 'os-widget'
  ) {
    return labels.prototype;
  }
  if (project.intent === 'live-artifact') return labels.liveArtifact;
  if (project.intent === 'slide') return labels.slide;
  if (project.intent === 'media') return labels.media;
  if (
    project.surface === 'image' ||
    project.surface === 'video' ||
    project.surface === 'audio'
  ) {
    return labels.media;
  }
  return '';
}

export function defaultIntentForSurface(
  surface: DesignSurface,
): DesignProjectIntent {
  if (surface === 'prototype') return 'app-screen';
  if (surface === 'deck') return 'slide';
  if (surface === 'image' || surface === 'video' || surface === 'audio') {
    return 'media';
  }
  if (surface === 'campaign' || surface === 'template') return 'landing-page';
  return 'other';
}

export interface RelativeTimeLabels {
  justNow: string;
  minutesAgo: string;
  hoursAgo: string;
  daysAgo: string;
}

export function relativeTime(value: string, labels: RelativeTimeLabels) {
  const delta = Date.now() - Date.parse(value);
  if (!Number.isFinite(delta) || delta < 60_000) return labels.justNow;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return labels.minutesAgo.replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return labels.hoursAgo.replace('{n}', String(hours));
  return labels.daysAgo.replace('{n}', String(Math.floor(hours / 24)));
}
