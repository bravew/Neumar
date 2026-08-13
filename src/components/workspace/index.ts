// Types
export type {
  DefaultWorkspaceProps,
  MediaVersion,
  WorkspaceContext,
  WorkspaceProps,
  WorkspaceRegistration,
} from './types';

// Registry
export {
  getWorkspaceRegistry,
  registerWorkspace,
  resolveWorkspace,
} from './registry';

// Components
export { WorkspaceRouter } from './WorkspaceRouter';
export { DefaultWorkspace } from './DefaultWorkspace';
export { WorkspacePanel } from './WorkspacePanel';
export { WorkspaceFileTree } from './WorkspaceFileTree';
export type { DiffEntry } from './WorkspaceDiffView';
