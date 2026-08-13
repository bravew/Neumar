/**
 * PluginUseButton — the "Use" action for an installed plugin.
 *
 * When the plugin ships an example query it renders a split button: the primary
 * "Use" seeds that query into the composer, and the dropdown offers "Use
 * without prompt" (attach the plugin, empty composer). Plugins with no example
 * query render a plain "Use" (attach only). Mirrors Open Design's split.
 */

import { ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

export function PluginUseButton({
  canSeed,
  onUse,
  onUseWithoutPrompt,
  size = 'sm',
  className,
}: {
  /** True when the plugin has an example query to seed. */
  canSeed: boolean;
  /** Apply the plugin and seed its example query. */
  onUse: () => void;
  /** Apply the plugin without seeding a prompt. */
  onUseWithoutPrompt: () => void;
  size?: 'sm' | 'default';
  className?: string;
}) {
  const { t } = useLanguage();

  if (!canSeed) {
    return (
      <Button size={size} className={className} onClick={onUseWithoutPrompt}>
        {t.plugins.actions.use}
      </Button>
    );
  }

  return (
    <div className={cn('inline-flex', className)}>
      <Button size={size} className="rounded-r-none" onClick={onUse}>
        {t.plugins.actions.use}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size={size}
            aria-label={t.plugins.actions.useOptions}
            className="border-primary-foreground/20 rounded-l-none border-l px-1.5"
          >
            <ChevronDown className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-64">
          <DropdownMenuItem
            onSelect={onUse}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-sm">{t.plugins.actions.use}</span>
            <span className="text-muted-foreground text-xs">
              {t.plugins.actions.useHint}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={onUseWithoutPrompt}
            className="flex-col items-start gap-0.5"
          >
            <span className="text-sm">
              {t.plugins.actions.useWithoutPrompt}
            </span>
            <span className="text-muted-foreground text-xs">
              {t.plugins.actions.useWithoutPromptHint}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
