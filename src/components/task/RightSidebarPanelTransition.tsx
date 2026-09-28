import type { ReactNode } from 'react';
import { ViewTransition } from 'react';

/**
 * Wraps the task view's right-sidebar panel so show/hide toggles use
 * React 19.3's stable `<ViewTransition>` instead of an instant mount/unmount.
 * The caller must mount/unmount `children` conditionally (see
 * `TaskDetailV2.tsx`'s `isRightSidebarVisible` toggle) and flip that state
 * inside `startTransition` — a plain `setState` does not activate the
 * transition.
 *
 * `default="none"` keeps unrelated content changes inside the panel (new
 * artifacts streaming in, tool selection, etc.) from triggering an
 * animation; only the panel's own mount (`enter`) and unmount (`exit`) do.
 * `prefers-reduced-motion` is handled by the global CSS media query in
 * `src/config/style/global.css`, which zeroes the animation duration for
 * every view-transition pseudo-element, including `.sidebar-panel-enter`/
 * `.sidebar-panel-exit` below.
 */
export function RightSidebarPanelTransition({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ViewTransition
      enter="sidebar-panel-enter"
      exit="sidebar-panel-exit"
      default="none"
    >
      {children}
    </ViewTransition>
  );
}
