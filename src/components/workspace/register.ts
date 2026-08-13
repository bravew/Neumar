import { lazy } from 'react';

import { registerWorkspace } from './registry';
import type { WorkspaceProps } from './types';

const LazyMediaWorkspace = lazy(
  () => import('./media/MediaWorkspace'),
) as React.ComponentType<WorkspaceProps>;

export function initWorkspaces(): void {
  registerWorkspace({
    id: 'media',
    name: 'Media Workspace',
    types: ['image', 'video', 'audio'],
    priority: 10,
    component: LazyMediaWorkspace,
  });
}
