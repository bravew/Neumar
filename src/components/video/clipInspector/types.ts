import type { useLanguage } from '@/shared/providers/language-provider';

export type ClipInspectorLabels = ReturnType<
  typeof useLanguage
>['t']['video']['editor']['clipInspector'];

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}
