import { useLanguage } from '@/shared/providers/language-provider';

interface DashboardProps {
  metrics: {
    activeChannels: number;
    totalChannels: number;
    messagesToday: number;
    errorsToday: number;
    avgLatencyMs: number;
  };
}

export function GatewayDashboard({ metrics }: DashboardProps) {
  const { t } = useLanguage();

  const cards = [
    {
      id: 'channels',
      label: t.settings.gatewayActiveChannels,
      value: `${metrics.activeChannels}/${metrics.totalChannels}`,
    },
    {
      id: 'messages',
      label: t.settings.gatewayMessagesToday,
      value: String(metrics.messagesToday),
    },
    {
      id: 'errors',
      label: t.settings.gatewayErrorsToday,
      value: String(metrics.errorsToday),
    },
    {
      id: 'latency',
      label: t.settings.gatewayAvgLatency,
      value: `${metrics.avgLatencyMs}ms`,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map((card) => (
        <div
          key={card.id}
          className="bg-muted/50 border-border rounded-lg border p-3 text-center"
        >
          <div className="text-foreground text-xl font-semibold">
            {card.value}
          </div>
          <div className="text-muted-foreground text-xs">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
