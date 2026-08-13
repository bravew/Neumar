import { useEffect, useState } from 'react';

import { CheckCircle2, CircleX, PlayCircle, StopCircle } from 'lucide-react';
import { motion } from 'motion/react';

import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { CostPanel } from '@/components/dashboard/CostPanel';
import { TaskFlowChart } from '@/components/dashboard/TaskFlowChart';
import { LeftSidebar, SidebarProvider } from '@/components/layout';
import { API_BASE_URL } from '@/config';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

// ============================================================================
// Types
// ============================================================================

interface DashboardStats {
  tasks: Record<string, number>;
  activeProjects: number;
  totalCost: number;
}

// ============================================================================
// Page Component
// ============================================================================

export function DashboardPage() {
  return (
    <SidebarProvider>
      <DashboardContent />
    </SidebarProvider>
  );
}

// ============================================================================
// Content
// ============================================================================

function DashboardContent() {
  const { t } = useLanguage();
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/db/dashboard/stats`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then(setStats)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <div
      className="bg-sidebar flex h-screen overflow-hidden"
      data-testid="dashboard-page"
    >
      <LeftSidebar tasks={[]} />
      <main className="bg-background my-2 mr-2 flex flex-1 flex-col overflow-hidden rounded-l-2xl shadow-sm">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-4xl px-6 py-8">
            <h1 className="text-foreground mb-6 text-2xl font-semibold">
              {t.dashboard.title}
            </h1>

            {/* Stats Cards */}
            {stats && (
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label={t.dashboard.tasksRunning}
                  value={stats.tasks.running || 0}
                  icon={<PlayCircle className="size-4 text-blue-500" />}
                />
                <StatCard
                  label={t.dashboard.tasksCompleted}
                  value={stats.tasks.completed || 0}
                  icon={<CheckCircle2 className="size-4 text-green-500" />}
                />
                <StatCard
                  label={t.dashboard.tasksFailed}
                  value={stats.tasks.error || 0}
                  icon={<CircleX className="size-4 text-red-500" />}
                />
                <StatCard
                  label={t.dashboard.tasksStopped}
                  value={stats.tasks.stopped || 0}
                  icon={<StopCircle className="size-4 text-gray-500" />}
                />
              </div>
            )}

            {/* Main Grid */}
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Activity Feed */}
              <DashboardCard title={t.dashboard.recentActivity}>
                <ActivityFeed />
              </DashboardCard>

              {/* Task Flow Chart */}
              <DashboardCard
                title={`${t.dashboard.taskFlow} — ${t.dashboard.last7Days}`}
              >
                <TaskFlowChart />
              </DashboardCard>

              {/* Cost Summary */}
              <DashboardCard
                title={t.dashboard.costSummary}
                className="lg:col-span-2"
              >
                <CostPanel />
              </DashboardCard>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border-border rounded-xl border p-4"
    >
      <div className="mb-1 flex items-center gap-2">
        {icon}
        <span className="text-muted-foreground text-xs">{label}</span>
      </div>
      <p className="text-foreground text-2xl font-semibold">{value}</p>
    </motion.div>
  );
}

function DashboardCard({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('bg-card border-border rounded-xl border p-4', className)}
    >
      <h2 className="text-foreground mb-3 text-sm font-medium">{title}</h2>
      {children}
    </motion.div>
  );
}
