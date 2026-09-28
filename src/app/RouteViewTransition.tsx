import type { ReactNode } from 'react';
import { ViewTransition } from 'react';

/**
 * Wraps the router's persistent `<Outlet />` mount point in React's stable
 * `<ViewTransition>` (React 19.3). The Outlet itself never mounts/unmounts
 * across navigations — only its rendered child changes — so this fires the
 * `update` cross-fade rather than `enter`/`exit`. `default="none"` keeps
 * unrelated re-renders (e.g. provider state changes elsewhere in the layout)
 * from triggering an unwanted animation.
 *
 * `prefers-reduced-motion` is handled entirely in CSS: the `.page-fade`
 * animation duration is zeroed out by the global reduced-motion media query
 * in `src/config/style/global.css`, so no JS-level branching is needed here.
 *
 * React Router's own `navigate(path, { viewTransition: true })` option
 * drives the same underlying `document.startViewTransition()` browser API.
 * Per React's docs, React interrupts any view transition already running
 * when a `<ViewTransition>` boundary is present, so call sites that still
 * pass `viewTransition: true` were migrated to rely on this wrapper instead
 * of running both mechanisms for the same navigation.
 */
export function RouteViewTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition default="none" update="page-fade">
      {children}
    </ViewTransition>
  );
}
