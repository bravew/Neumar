import type { CreativeWorkflowStep } from '@/shared/creative-workflow';

import type { VideoEditorStep } from './editorTypes';
import { VIDEO_EDITOR_STEPS } from './editorTypes';
import type { SideRailTab } from './SideRail';

/**
 * Which Preview artefact is on screen: the live timeline simulation, or the
 * file the last render produced.
 */
export type PreviewView = 'preview' | 'output';

/**
 * Everything about the editor's location that belongs in the URL.
 *
 * One key per thing it controls. The previous `stage` key carried three
 * unrelated jobs at once — highlighting a progress pill, opening the assets
 * rail, and choosing Preview versus Output — which is why a single screen
 * needed two rows of navigation to explain itself.
 */
export interface EditorLocation {
  step: VideoEditorStep;
  /** Side rail tab to force open, or null to leave the user's choice alone. */
  rail: SideRailTab | null;
  /** Only meaningful on `step: 'preview'`; null everywhere else. */
  view: PreviewView | null;
  /** Reveal and focus HTML authoring, which is otherwise not mounted. */
  html: boolean;
}

const SIDE_RAIL_TABS: readonly SideRailTab[] = [
  'brief',
  'assets',
  'transitions',
  'overlays',
  'sources',
  'brand',
  'transcript',
  'inspector',
];

const PREVIEW_VIEWS: readonly PreviewView[] = ['preview', 'output'];

export function parseEditorStep(value: string | null): VideoEditorStep | null {
  if (!value) return null;
  return VIDEO_EDITOR_STEPS.includes(value as VideoEditorStep)
    ? (value as VideoEditorStep)
    : null;
}

function parseRail(value: string | null): SideRailTab | null {
  if (!value) return null;
  return SIDE_RAIL_TABS.includes(value as SideRailTab)
    ? (value as SideRailTab)
    : null;
}

function parseView(value: string | null): PreviewView | null {
  if (!value) return null;
  return PREVIEW_VIEWS.includes(value as PreviewView)
    ? (value as PreviewView)
    : null;
}

/**
 * Read the editor's location from the URL, falling back to the step derived
 * from project state when the link does not name one.
 *
 * Invalid values are dropped rather than honoured: an unknown rail tab or a
 * `view` outside Preview would otherwise put the editor in a state no control
 * can undo.
 */
export function parseEditorLocation(
  params: URLSearchParams,
  derivedStep: VideoEditorStep,
): EditorLocation {
  const step = parseEditorStep(params.get('step')) ?? derivedStep;
  return {
    step,
    rail: parseRail(params.get('rail')),
    // A view only exists on Preview; elsewhere there is no control to change
    // it, so honouring one would be a state the user could not leave.
    view: step === 'preview' ? parseView(params.get('view')) : null,
    html: params.get('html') === '1',
  };
}

/**
 * The canvas that a workflow stage's primary action should open.
 *
 * Lossy on purpose — intent and assets both live in Brief, review and export
 * both live in Preview — which is exactly why stages are a progress summary
 * and the canvases are the navigation.
 */
export function editorStepForWorkflowStep(
  step: CreativeWorkflowStep,
): VideoEditorStep {
  switch (step) {
    case 'intent':
    case 'assets':
      return 'brief';
    case 'plan':
      return 'board';
    case 'generate':
      return 'generate';
    case 'review':
    case 'export':
      return 'preview';
  }
}

/**
 * The canonical query string for a location, so one screen has exactly one
 * URL. Keys that carry no information are omitted rather than written empty.
 */
export function editorLocationParams(
  location: EditorLocation,
  base?: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base);
  next.set('step', location.step);

  if (location.rail) next.set('rail', location.rail);
  else next.delete('rail');

  if (location.step === 'preview' && location.view) {
    next.set('view', location.view);
  } else {
    next.delete('view');
  }

  if (location.html) next.set('html', '1');
  else next.delete('html');

  return next;
}
