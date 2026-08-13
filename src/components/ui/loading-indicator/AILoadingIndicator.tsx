import { useAnimationPreference } from '@/config/animation';

import { LargeIndicator } from './LargeIndicator';
import { MediumIndicator } from './MediumIndicator';
import { SmallIndicator } from './SmallIndicator';
import type {
  AILoadingIndicatorProps,
  AILoadingSize,
  IndicatorProps,
} from './types';
import { XLargeIndicator } from './XLargeIndicator';

const VARIANT_MAP: Record<
  AILoadingSize,
  (props: IndicatorProps) => React.JSX.Element
> = {
  sm: SmallIndicator,
  md: MediumIndicator,
  lg: LargeIndicator,
  xl: XLargeIndicator,
};

export function AILoadingIndicator({
  size = 'sm',
  className,
  label = 'Loading',
  statusText,
}: AILoadingIndicatorProps) {
  const reducedMotion = useAnimationPreference();
  const Variant = VARIANT_MAP[size];

  return (
    <div
      role="status"
      aria-label={label}
      className="inline-flex items-center gap-2"
    >
      <Variant className={className} reducedMotion={reducedMotion} />
      {statusText && (
        <span className="text-muted-foreground text-sm">{statusText}</span>
      )}
    </div>
  );
}
