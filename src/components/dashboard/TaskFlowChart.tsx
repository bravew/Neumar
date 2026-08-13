import { useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: 'var(--color-card)',
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  fontSize: '12px',
};

interface FlowData {
  date: string;
  created: number;
  completed: number;
  failed: number;
}

export function TaskFlowChart() {
  const { t } = useLanguage();
  const [data, setData] = useState<FlowData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${API_BASE_URL}/db/dashboard/task-flow?days=7`, {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((raw: FlowData[]) => {
        // Ensure we show 7 days even if some are missing
        const today = new Date();
        const days: FlowData[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split('T')[0]!;
          const existing = raw.find((r) => r.date === dateStr);
          days.push(
            existing || { date: dateStr, created: 0, completed: 0, failed: 0 },
          );
        }
        setData(days);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <p className="text-muted-foreground py-8 text-center text-sm">
        {t.dashboard.noData}
      </p>
    );
  }

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barGap={2}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
          <XAxis
            dataKey="date"
            tickFormatter={(val: string) => {
              const d = new Date(val + 'T00:00:00');
              return d.toLocaleDateString(undefined, {
                weekday: 'short',
              });
            }}
            fontSize={12}
          />
          <YAxis allowDecimals={false} fontSize={12} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="created"
            name={t.dashboard.tasksCreated}
            fill="#6366f1"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="completed"
            name={t.dashboard.tasksCompleted}
            fill="#22c55e"
            radius={[2, 2, 0, 0]}
          />
          <Bar
            dataKey="failed"
            name={t.dashboard.tasksFailed}
            fill="#ef4444"
            radius={[2, 2, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
