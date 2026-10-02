import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Loader = () => Promise<unknown>;

interface RouteLoader {
  id: string;
  match: (pathname: string) => boolean;
  load: Loader;
}

function lazyPage<M>(
  load: () => Promise<M>,
  pick: (mod: M) => ComponentType,
): LazyExoticComponent<ComponentType> {
  return lazy(() => load().then((mod) => ({ default: pick(mod) })));
}

const loadHome = () => import('@/app/pages/Home');
const loadTask = () => import('@/app/pages/TaskDetail');
const loadLibrary = () => import('@/app/pages/Library');
const loadAutomation = () => import('@/app/pages/Automation');
const loadSetup = () => import('@/app/pages/Setup');
const loadProjects = () => import('@/app/pages/Projects');
const loadProjectDetail = () => import('@/app/pages/ProjectDetail');
const loadDashboard = () => import('@/app/pages/Dashboard');
const loadApprovals = () => import('@/app/pages/Approvals');
const loadOrg = () => import('@/app/pages/OrgView');
const loadProfile = () => import('@/app/pages/ProfileDetail');
const loadTaskV2 = () => import('@/app/pages/TaskDetailV2');
const loadQuickStart = () => import('@/app/pages/QuickStartWizard');
const loadDesign = () => import('@/app/pages/DesignMode');
const loadVideo = () => import('@/app/pages/VideoMode');
const loadVideoProject = () => import('@/app/pages/VideoMode/VideoProjectView');
const loadVideoRenderHost = () => import('@/app/pages/VideoRenderHost');
const loadVideoProviders = () =>
  import('@/app/pages/VideoMode/settings/ProvidersPage');
const loadVideoTemplates = () =>
  import('@/app/pages/VideoMode/settings/TemplatesPage');
const loadVideoBrand = () => import('@/app/pages/VideoMode/settings/BrandPage');
const loadVideoMemory = () =>
  import('@/app/pages/VideoMode/settings/MemoryPage');
const loadVideoAssets = () =>
  import('@/app/pages/VideoMode/settings/AssetsPage');
const loadChat = () => import('@/app/pages/ChatPlaceholder');

export const HomePage = lazyPage(loadHome, (mod) => mod.HomePage);
export const TaskDetailPage = lazyPage(loadTask, (mod) => mod.TaskDetailPage);
export const LibraryPage = lazyPage(loadLibrary, (mod) => mod.LibraryPage);
export const AutomationPage = lazyPage(
  loadAutomation,
  (mod) => mod.AutomationPage,
);
export const SetupPage = lazyPage(loadSetup, (mod) => mod.SetupPage);
export const ProjectsPage = lazyPage(loadProjects, (mod) => mod.ProjectsPage);
export const ProjectDetailPage = lazyPage(
  loadProjectDetail,
  (mod) => mod.ProjectDetailPage,
);
export const DashboardPage = lazyPage(
  loadDashboard,
  (mod) => mod.DashboardPage,
);
export const ApprovalsPage = lazyPage(
  loadApprovals,
  (mod) => mod.ApprovalsPage,
);
export const OrgViewPage = lazyPage(loadOrg, (mod) => mod.OrgViewPage);
export const ProfileDetailPage = lazyPage(
  loadProfile,
  (mod) => mod.ProfileDetailPage,
);
export const TaskDetailV2Page = lazyPage(
  loadTaskV2,
  (mod) => mod.TaskDetailV2Page,
);
export const QuickStartWizardPage = lazyPage(
  loadQuickStart,
  (mod) => mod.QuickStartWizard,
);
export const DesignModePage = lazyPage(
  loadDesign,
  (mod) => mod.DesignModeRoute,
);
export const VideoModePage = lazyPage(loadVideo, (mod) => mod.VideoModeRoute);
export const VideoProjectViewPage = lazyPage(
  loadVideoProject,
  (mod) => mod.VideoProjectRoute,
);
export const VideoRenderHostPage = lazyPage(
  loadVideoRenderHost,
  (mod) => mod.VideoRenderHostPage,
);
export const VideoProvidersSettingsPage = lazyPage(
  loadVideoProviders,
  (mod) => mod.VideoProvidersSettingsPage,
);
export const VideoTemplatesSettingsPage = lazyPage(
  loadVideoTemplates,
  (mod) => mod.VideoTemplatesSettingsPage,
);
export const VideoBrandSettingsPage = lazyPage(
  loadVideoBrand,
  (mod) => mod.VideoBrandSettingsPage,
);
export const VideoMemorySettingsPage = lazyPage(
  loadVideoMemory,
  (mod) => mod.VideoMemorySettingsPage,
);
export const VideoAssetsLibraryPage = lazyPage(
  loadVideoAssets,
  (mod) => mod.VideoAssetsLibraryPage,
);
export const ChatPlaceholderPage = lazyPage(
  loadChat,
  (mod) => mod.ChatPlaceholderPage,
);

const is = (path: string) => (pathname: string) => pathname === path;
const under = (path: string) => (pathname: string) =>
  pathname === path || pathname.startsWith(`${path}/`);

const ROUTE_LOADERS: RouteLoader[] = [
  { id: 'home', match: is('/'), load: loadHome },
  { id: 'task-v2', match: under('/task-v2'), load: loadTaskV2 },
  { id: 'task', match: under('/task'), load: loadTask },
  { id: 'library', match: is('/library'), load: loadLibrary },
  { id: 'automation', match: under('/automation'), load: loadAutomation },
  {
    id: 'video-providers',
    match: is('/video/settings/providers'),
    load: loadVideoProviders,
  },
  {
    id: 'video-templates',
    match: is('/video/settings/templates'),
    load: loadVideoTemplates,
  },
  {
    id: 'video-brand',
    match: is('/video/settings/brand'),
    load: loadVideoBrand,
  },
  {
    id: 'video-memory',
    match: is('/video/settings/memory'),
    load: loadVideoMemory,
  },
  {
    id: 'video-assets',
    match: is('/video/library/assets'),
    load: loadVideoAssets,
  },
  {
    id: 'video-project',
    match: (pathname) => /^\/video\/[^/]+/.test(pathname),
    load: loadVideoProject,
  },
  { id: 'video', match: is('/video'), load: loadVideo },
  { id: 'design', match: under('/design'), load: loadDesign },
  { id: 'chat', match: under('/chat'), load: loadChat },
  { id: 'dashboard', match: is('/dashboard'), load: loadDashboard },
  { id: 'approvals', match: is('/approvals'), load: loadApprovals },
  {
    id: 'project-detail',
    match: (pathname) => /^\/projects\/[^/]+$/.test(pathname),
    load: loadProjectDetail,
  },
  { id: 'projects', match: is('/projects'), load: loadProjects },
  {
    id: 'org-detail',
    match: (pathname) => /^\/org\/[^/]+$/.test(pathname),
    load: loadProfile,
  },
  { id: 'org', match: is('/org'), load: loadOrg },
  { id: 'setup', match: is('/setup'), load: loadSetup },
  { id: 'quickstart', match: is('/quickstart'), load: loadQuickStart },
  {
    id: 'video-render-host',
    match: is('/video-render-host'),
    load: loadVideoRenderHost,
  },
];

const started = new Set<string>();

export function routePathname(href: string): string {
  const trimmed = href.trim();
  if (!trimmed) return '/';
  const withoutHash = trimmed.split('#')[0] ?? trimmed;
  const withoutQuery = withoutHash.split('?')[0] ?? withoutHash;
  const withSlash = withoutQuery.startsWith('/')
    ? withoutQuery
    : `/${withoutQuery}`;
  if (withSlash.length > 1 && withSlash.endsWith('/')) {
    return withSlash.slice(0, -1);
  }
  return withSlash;
}

export function routeLoaderId(href: string): string | null {
  const pathname = routePathname(href);
  return ROUTE_LOADERS.find((entry) => entry.match(pathname))?.id ?? null;
}

/** Warm the lazy route chunk for a nav href. Safe to call on hover and focus. */
export function preloadRoute(href: string): void {
  const id = routeLoaderId(href);
  if (!id || started.has(id)) return;
  const entry = ROUTE_LOADERS.find((candidate) => candidate.id === id);
  if (!entry) return;
  started.add(id);
  void entry.load().catch(() => {
    started.delete(id);
  });
}
