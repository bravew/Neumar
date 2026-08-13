export type AILoadingSize = 'sm' | 'md' | 'lg' | 'xl';

export interface AILoadingIndicatorProps {
  size?: AILoadingSize;
  className?: string;
  /** Accessible label for screen readers */
  label?: string;
  /** Optional text to display next to the indicator */
  statusText?: string;
}

export interface IndicatorProps {
  className?: string;
  /** When true, animations are disabled for prefers-reduced-motion */
  reducedMotion?: boolean;
}
