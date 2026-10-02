import type { ReactNode } from 'react';

import { cn } from '@/shared/lib/utils';

export type RouteSkeletonShape =
  | 'home'
  | 'task'
  | 'library'
  | 'automation'
  | 'settings'
  | 'page';

function Bar({ className }: { className: string }) {
  return <div className={cn('bg-muted animate-pulse rounded-md', className)} />;
}

function Shell({
  shape,
  children,
}: {
  shape: RouteSkeletonShape;
  children: ReactNode;
}) {
  return (
    <div
      className="bg-sidebar flex h-svh"
      data-testid={`route-skeleton-${shape}`}
      aria-busy="true"
    >
      <div className="border-sidebar-border w-72 shrink-0 space-y-2 border-r p-3">
        <Bar className="h-8 w-full" />
        <Bar className="h-8 w-full" />
        <Bar className="h-8 w-4/5" />
        <Bar className="h-8 w-full" />
      </div>
      <div className="bg-background m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl p-6">
        {children}
      </div>
    </div>
  );
}

function HomeBody() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6">
      <Bar className="size-8" />
      <Bar className="h-9 w-64" />
      <Bar className="h-28 w-full max-w-2xl rounded-2xl" />
      <div className="flex gap-2">
        <Bar className="h-8 w-20" />
        <Bar className="h-8 w-20" />
        <Bar className="h-8 w-20" />
      </div>
    </div>
  );
}

function TaskBody() {
  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Bar className="h-16 w-2/3" />
        <Bar className="h-24 w-full" />
        <Bar className="h-16 w-1/2 self-end" />
        <Bar className="mt-auto h-24 w-full rounded-2xl" />
      </div>
      <div className="hidden w-72 shrink-0 flex-col gap-3 md:flex">
        <Bar className="h-8 w-24" />
        <Bar className="h-10 w-full" />
        <Bar className="h-10 w-full" />
        <Bar className="h-10 w-4/5" />
      </div>
    </div>
  );
}

function LibraryBody() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <Bar className="h-8 w-40" />
      <Bar className="h-10 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-5/6" />
    </div>
  );
}

function AutomationBody() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Bar className="h-7 w-40" />
        <Bar className="h-9 w-28" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Bar className="h-32 w-full" />
        <Bar className="h-32 w-full" />
        <Bar className="h-32 w-full" />
      </div>
    </div>
  );
}

function SettingsBody() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3">
      <Bar className="mb-2 h-7 w-36" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-full" />
      <Bar className="h-14 w-4/5" />
    </div>
  );
}

const BODIES: Record<RouteSkeletonShape, () => ReactNode> = {
  home: HomeBody,
  task: TaskBody,
  library: LibraryBody,
  automation: AutomationBody,
  settings: SettingsBody,
  page: LibraryBody,
};

export function RouteSkeleton({ shape }: { shape: RouteSkeletonShape }) {
  const Body = BODIES[shape];
  return (
    <Shell shape={shape}>
      <Body />
    </Shell>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2 py-2" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <Bar key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}
