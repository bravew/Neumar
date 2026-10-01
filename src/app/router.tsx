import { Suspense } from 'react';

import { createBrowserRouter, Navigate } from 'react-router-dom';

import { AppRouteProviders } from '@/app/AppRouteProviders';
import { AppShellLayout, ChromelessLayout } from '@/app/AppShellLayout';
import { ChatDockEntry } from '@/app/pages/ChatDockEntry';
import { RouteErrorPage } from '@/app/pages/RouteError';
import { RouteFallback } from '@/app/route-fallback';
import {
  ApprovalsPage,
  AutomationPage,
  DashboardPage,
  DesignModePage,
  HomePage,
  LibraryPage,
  OrgViewPage,
  ProfileDetailPage,
  ProjectDetailPage,
  ProjectsPage,
  QuickStartWizardPage,
  SetupPage,
  TaskDetailPage,
  TaskDetailV2Page,
  VideoAssetsLibraryPage,
  VideoBrandSettingsPage,
  VideoMemorySettingsPage,
  VideoModePage,
  VideoProjectViewPage,
  VideoProvidersSettingsPage,
  VideoRenderHostPage,
  VideoTemplatesSettingsPage,
} from '@/app/route-preload';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppRouteProviders />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <AppShellLayout />,
        children: [
          {
            index: true,
            element: (
              <RouteFallback shape="home">
                <HomePage />
              </RouteFallback>
            ),
          },
          {
            path: 'task/:taskId',
            element: (
              <RouteFallback shape="task">
                <TaskDetailPage />
              </RouteFallback>
            ),
          },
          {
            path: 'task-v2/:taskId',
            element: (
              <RouteFallback shape="task">
                <TaskDetailV2Page />
              </RouteFallback>
            ),
          },
          {
            path: 'library',
            element: (
              <RouteFallback shape="library">
                <LibraryPage />
              </RouteFallback>
            ),
          },
          {
            path: 'automation',
            element: (
              <RouteFallback shape="automation">
                <AutomationPage />
              </RouteFallback>
            ),
          },
          {
            path: 'projects',
            element: (
              <RouteFallback shape="page">
                <ProjectsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'projects/:id',
            element: (
              <RouteFallback shape="page">
                <ProjectDetailPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video',
            element: (
              <RouteFallback shape="page">
                <VideoModePage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/settings/providers',
            element: (
              <RouteFallback shape="settings">
                <VideoProvidersSettingsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/settings/templates',
            element: (
              <RouteFallback shape="settings">
                <VideoTemplatesSettingsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/settings/brand',
            element: (
              <RouteFallback shape="settings">
                <VideoBrandSettingsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/settings/memory',
            element: (
              <RouteFallback shape="settings">
                <VideoMemorySettingsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/library/assets',
            element: (
              <RouteFallback shape="library">
                <VideoAssetsLibraryPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/:projectId/timeline',
            element: (
              <RouteFallback shape="page">
                <VideoProjectViewPage />
              </RouteFallback>
            ),
          },
          {
            path: 'video/:projectId',
            element: (
              <RouteFallback shape="page">
                <VideoProjectViewPage />
              </RouteFallback>
            ),
          },
          {
            path: 'chat',
            element: (
              <RouteFallback shape="page">
                <ChatDockEntry />
              </RouteFallback>
            ),
          },
          {
            path: 'dashboard',
            element: (
              <RouteFallback shape="page">
                <DashboardPage />
              </RouteFallback>
            ),
          },
          {
            path: 'agent-profiles',
            element: <Navigate to="/org" replace />,
          },
          {
            path: 'approvals',
            element: (
              <RouteFallback shape="page">
                <ApprovalsPage />
              </RouteFallback>
            ),
          },
          {
            path: 'org',
            element: (
              <RouteFallback shape="page">
                <OrgViewPage />
              </RouteFallback>
            ),
          },
          {
            path: 'org/:id',
            element: (
              <RouteFallback shape="page">
                <ProfileDetailPage />
              </RouteFallback>
            ),
          },
        ],
      },
      {
        element: <ChromelessLayout />,
        children: [
          {
            path: 'design',
            element: (
              <RouteFallback shape="page">
                <DesignModePage />
              </RouteFallback>
            ),
          },
          {
            path: 'design/:projectId',
            element: (
              <RouteFallback shape="page">
                <DesignModePage />
              </RouteFallback>
            ),
          },
          {
            path: 'setup',
            element: (
              <RouteFallback shape="page" guard={false}>
                <SetupPage />
              </RouteFallback>
            ),
          },
          {
            path: 'quickstart',
            element: (
              <RouteFallback shape="page" guard={false}>
                <QuickStartWizardPage />
              </RouteFallback>
            ),
          },
        ],
      },
      {
        path: 'video-render-host',
        element: (
          <Suspense fallback={null}>
            <VideoRenderHostPage />
          </Suspense>
        ),
      },
    ],
  },
]);
