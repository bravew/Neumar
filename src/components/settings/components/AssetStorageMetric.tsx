interface AssetStorageMetricProps {
  label: string;
  value: number;
}

export function AssetStorageMetric({ label, value }: AssetStorageMetricProps) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground truncate text-xs">{label}</p>
      <p className="text-foreground font-medium">{formatBytes(value)}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
