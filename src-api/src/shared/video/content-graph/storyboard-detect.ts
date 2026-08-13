import type { Storyboard, StoryboardScene } from '@/shared/video/types';

// Phase 1 M5 — auto-detect helpers used by the queue.
//
// `renderProject` inspects the project's in-memory storyboard and routes
// through the materializer pre-pass when this returns true. Keeping the
// rule in one place ensures every consumer (jobs.ts, pipeline.ts,
// render-status surfaces) shares the same definition of "this is an
// HTML-engine project."
//
// See dev-doc/html-video/06-06/03-slice-B-queue-integration.md.

/** True iff at least one scene carries `htmlFrameSeed`. */
export function isHtmlStoryboard(
  storyboard?: Storyboard | null,
): storyboard is Storyboard {
  if (!storyboard) return false;
  if (!Array.isArray(storyboard.scenes)) return false;
  return storyboard.scenes.some(isHtmlSeededScene);
}

/** Per-scene predicate exposed for tests and the materializer's pre-pass. */
export function isHtmlSeededScene(
  scene: StoryboardScene,
): scene is StoryboardScene & {
  htmlFrameSeed: NonNullable<StoryboardScene['htmlFrameSeed']>;
} {
  return scene.htmlFrameSeed !== undefined && scene.htmlFrameSeed !== null;
}

/**
 * Return the (unique) template id the storyboard's HTML scenes were lowered
 * from. A storyboard with multiple template ids on its HTML scenes is a bug
 * surface — the lowering compiler emits one template per content-graph — so
 * we throw rather than silently picking the first one.
 */
export function htmlStoryboardTemplateId(storyboard: Storyboard): string {
  const ids = new Set<string>();
  for (const scene of storyboard.scenes) {
    if (isHtmlSeededScene(scene)) {
      ids.add(scene.htmlFrameSeed.templateId);
    }
  }
  if (ids.size === 0) {
    throw new Error(
      'htmlStoryboardTemplateId: storyboard has no HTML-seeded scenes',
    );
  }
  if (ids.size > 1) {
    throw new Error(
      `htmlStoryboardTemplateId: storyboard mixes ${ids.size} templates ` +
        `(${[...ids].join(', ')}); the lowering compiler should emit one ` +
        `template per content-graph`,
    );
  }
  return [...ids][0]!;
}
