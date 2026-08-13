import { lazy, Suspense } from 'react';

import { createBrowserRouter, Navigate } from 'react-router-dom';

import { motion } from 'motion/react';

import { AppRouteProviders } from '@/app/AppRouteProviders';
import { RouteErrorPage } from '@/app/pages/RouteError';
import { SetupGuard } from '@/components/setup-guard';

// Lazy load page components - only loaded when route is visited
const HomePage = lazy(() =>
  import('@/app/pages/Home').then((m) => ({ default: m.HomePage })),
);
const TaskDetailPage = lazy(() =>
  import('@/app/pages/TaskDetail').then((m) => ({ default: m.TaskDetailPage })),
);
const LibraryPage = lazy(() =>
  import('@/app/pages/Library').then((m) => ({ default: m.LibraryPage })),
);
const AutomationPage = lazy(() =>
  import('@/app/pages/Automation').then((m) => ({ default: m.AutomationPage })),
);
const SetupPage = lazy(() =>
  import('@/app/pages/Setup').then((m) => ({ default: m.SetupPage })),
);
const ProjectsPage = lazy(() =>
  import('@/app/pages/Projects').then((m) => ({ default: m.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('@/app/pages/ProjectDetail').then((m) => ({
    default: m.ProjectDetailPage,
  })),
);
const DashboardPage = lazy(() =>
  import('@/app/pages/Dashboard').then((m) => ({ default: m.DashboardPage })),
);
const ApprovalsPage = lazy(() =>
  import('@/app/pages/Approvals').then((m) => ({ default: m.ApprovalsPage })),
);
const OrgViewPage = lazy(() =>
  import('@/app/pages/OrgView').then((m) => ({ default: m.OrgViewPage })),
);
const ProfileDetailPage = lazy(() =>
  import('@/app/pages/ProfileDetail').then((m) => ({
    default: m.ProfileDetailPage,
  })),
);
const TaskDetailV2Page = lazy(() =>
  import('@/app/pages/TaskDetailV2').then((m) => ({
    default: m.TaskDetailV2Page,
  })),
);
const QuickStartWizardPage = lazy(() =>
  import('@/app/pages/QuickStartWizard').then((m) => ({
    default: m.QuickStartWizard,
  })),
);
const DesignModePage = lazy(() =>
  import('@/app/pages/DesignMode').then((m) => ({
    default: m.DesignModeRoute,
  })),
);
const VideoModePage = lazy(() =>
  import('@/app/pages/VideoMode').then((m) => ({
    default: m.VideoModeRoute,
  })),
);
const VideoProjectViewPage = lazy(() =>
  import('@/app/pages/VideoMode/VideoProjectView').then((m) => ({
    default: m.VideoProjectRoute,
  })),
);
const VideoRenderHostPage = lazy(() =>
  import('@/app/pages/VideoRenderHost').then((m) => ({
    default: m.VideoRenderHostPage,
  })),
);
const VideoProvidersSettingsPage = lazy(() =>
  import('@/app/pages/VideoMode/settings/ProvidersPage').then((m) => ({
    default: m.VideoProvidersSettingsPage,
  })),
);
const VideoTemplatesSettingsPage = lazy(() =>
  import('@/app/pages/VideoMode/settings/TemplatesPage').then((m) => ({
    default: m.VideoTemplatesSettingsPage,
  })),
);
const VideoBrandSettingsPage = lazy(() =>
  import('@/app/pages/VideoMode/settings/BrandPage').then((m) => ({
    default: m.VideoBrandSettingsPage,
  })),
);
const VideoMemorySettingsPage = lazy(() =>
  import('@/app/pages/VideoMode/settings/MemoryPage').then((m) => ({
    default: m.VideoMemorySettingsPage,
  })),
);
const VideoAssetsLibraryPage = lazy(() =>
  import('@/app/pages/VideoMode/settings/AssetsPage').then((m) => ({
    default: m.VideoAssetsLibraryPage,
  })),
);
const ChatPlaceholderPage = lazy(() =>
  import('@/app/pages/ChatPlaceholder').then((m) => ({
    default: m.ChatPlaceholderPage,
  })),
);

// Animated loading fallback with smooth spinner
function PageLoader() {
  return (
    <div className="bg-background flex min-h-svh items-center justify-center">
      <motion.div
        className="border-primary size-6 rounded-full border-2 border-t-transparent"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppRouteProviders />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <HomePage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'task/:taskId',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <TaskDetailPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'task-v2/:taskId',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <TaskDetailV2Page />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'library',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <LibraryPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'automation',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <AutomationPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'projects',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <ProjectsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'projects/:id',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <ProjectDetailPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'design',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <DesignModePage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'design/:projectId',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <DesignModePage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoModePage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/settings/providers',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoProvidersSettingsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/settings/templates',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoTemplatesSettingsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/settings/brand',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoBrandSettingsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/settings/memory',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoMemorySettingsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/library/assets',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoAssetsLibraryPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video/:projectId/timeline',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoProjectViewPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'video-render-host',
        element: (
          <Suspense fallback={null}>
            <VideoRenderHostPage />
          </Suspense>
        ),
      },
      {
        path: 'video/:projectId',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <VideoProjectViewPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'chat',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <ChatPlaceholderPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'dashboard',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <DashboardPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'agent-profiles',
        element: <Navigate to="/org" replace />,
      },
      {
        path: 'approvals',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <ApprovalsPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'setup',
        element: (
          <Suspense fallback={<PageLoader />}>
            <SetupPage />
          </Suspense>
        ),
      },
      {
        path: 'quickstart',
        element: (
          <Suspense fallback={<PageLoader />}>
            <QuickStartWizardPage />
          </Suspense>
        ),
      },
      {
        path: 'org',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <OrgViewPage />
            </Suspense>
          </SetupGuard>
        ),
      },
      {
        path: 'org/:id',
        element: (
          <SetupGuard>
            <Suspense fallback={<PageLoader />}>
              <ProfileDetailPage />
            </Suspense>
          </SetupGuard>
        ),
      },
    ],
  },
]);
