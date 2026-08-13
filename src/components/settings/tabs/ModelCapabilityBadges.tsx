import type { ModelCapability } from '@/shared/db/settings';
import {
  CAPABILITY_DISPLAY_ORDER,
  detectModelCapabilities,
  MODEL_CAPABILITY_META,
} from '@/shared/db/settings';
import { cn } from '@/shared/lib/utils';

/** Compact capability badge for a single model capability */
export function CapabilityBadge({
  capability,
}: {
  capability: ModelCapability;
}) {
  const meta = MODEL_CAPABILITY_META[capability];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0 text-[10px] leading-4 font-medium',
        meta.color,
      )}
      title={meta.label}
    >
      <span className="text-[9px]">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

/** Render all capability badges for a model, sorted by relevance */
export function ModelCapabilityBadges({ modelName }: { modelName: string }) {
  const capabilities = detectModelCapabilities(modelName);

  // Sort by the canonical order
  const sorted = [...capabilities].sort(
    (a, b) =>
      CAPABILITY_DISPLAY_ORDER.indexOf(a) - CAPABILITY_DISPLAY_ORDER.indexOf(b),
  );

  return (
    <span className="inline-flex flex-wrap gap-1">
      {sorted.map((cap) => (
        <CapabilityBadge key={cap} capability={cap} />
      ))}
    </span>
  );
}
