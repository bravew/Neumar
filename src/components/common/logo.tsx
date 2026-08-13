import ImageLogo from '@/assets/logo.png';
import { APP_NAME } from '@/config';
import { cn } from '@/shared/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <img src={ImageLogo} alt={APP_NAME} className="text-primary size-7" />
    </div>
  );
}
