/**
 * InstalledPluginDetailDialog — the detail view for an installed (or built-in)
 * plugin, as a modal dialog (Open Design parity) rather than a side sheet. It
 * reuses the rich installed body (author, example query, context bundles,
 * capability permissions, source) and adds installed-management extras: a live
 * design-system preview, signature status, host requirements, and config —
 * with enable/disable + uninstall in the footer.
 */

import { useCallback, useState } from 'react';

import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InstalledPlugin } from '@/shared/hooks/usePlugins';
import { useLanguage } from '@/shared/providers/language-provider';

import { Section, TrustBadge } from './DetailPrimitives';
import { InstalledDetailBody } from './InstalledDetailBody';
import { PluginConfigEditor } from './PluginConfigEditor';
import { PluginMoreMenu } from './PluginMoreMenu';
import { PluginPreview } from './PluginPreview';

export function InstalledPluginDetailDialog({
  plugin,
  open,
  pending,
  onOpenChange,
  onEnableToggle,
  onUninstall,
  onUse,
}: {
  plugin: InstalledPlugin | null;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onEnableToggle?: () => void;
  onUninstall?: () => void;
  onUse?: () => void;
}) {
  const { t } = useLanguage();
  const [previewOk, setPreviewOk] = useState(true);
  const onUnavailable = useCallback(() => setPreviewOk(false), []);

  const manifest = plugin?.manifest;
  const neuma = manifest?.metadata?.neuma;
  const isDesignSystem = !!neuma?.designManifest;
  const configSchema = neuma?.configSchema ?? [];
  const requires = neuma?.requires;
  const hasRequires =
    (requires?.anyBins?.length ?? 0) > 0 ||
    (requires?.envVars?.length ?? 0) > 0;
  const isSigned = plugin?.signatureOk === true;
  const isUnsigned = plugin?.signatureOk === false;
  const title = manifest?.displayName || plugin?.name;
  const surfaces = neuma?.surfaces ?? [];
  const canUse =
    !!onUse && (surfaces.includes('design') || surfaces.includes('video'));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-lg flex-col">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <DialogTitle className="flex items-center gap-2">
              <span className="truncate">{title}</span>
              {plugin?.marketplaceTrust ? (
                <TrustBadge trust={plugin.marketplaceTrust} />
              ) : null}
            </DialogTitle>
            {plugin ? <PluginMoreMenu plugin={plugin} entry={null} /> : null}
          </div>
          <DialogDescription className="font-mono text-xs">
            {plugin?.name}
            {plugin?.version ? ` · v${plugin.version}` : ''}
            {plugin?.scope ? ` · ${plugin.scope}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-2 flex-1 space-y-5 overflow-y-auto pr-2 text-sm">
          {plugin && isDesignSystem && previewOk ? (
            <Section title={t.plugins.details.preview}>
              <PluginPreview
                pluginId={plugin.id}
                onUnavailable={onUnavailable}
              />
            </Section>
          ) : null}

          {plugin ? <InstalledDetailBody plugin={plugin} entry={null} /> : null}

          {isSigned || isUnsigned ? (
            <div className="border-border flex items-center gap-2 rounded-md border p-2 text-xs">
              {isSigned ? (
                <>
                  <ShieldCheck className="size-4 shrink-0 text-emerald-500" />
                  <span>{t.plugins.status.signed}</span>
                </>
              ) : (
                <>
                  <ShieldAlert className="size-4 shrink-0 text-amber-500" />
                  <span>{t.plugins.status.unsigned}</span>
                </>
              )}
            </div>
          ) : null}

          {hasRequires ? (
            <Section title={t.plugins.install.permissions}>
              <ul className="text-muted-foreground space-y-0.5 text-xs">
                {requires?.anyBins?.map((b) => (
                  <li key={`bin-${b}`} className="font-mono">
                    bin: {b}
                  </li>
                ))}
                {requires?.envVars?.map((e) => (
                  <li key={`env-${e}`} className="font-mono">
                    env: {e}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {configSchema.length > 0 && plugin ? (
            <PluginConfigEditor pluginId={plugin.id} active={open} />
          ) : null}
        </div>

        <DialogFooter>
          {onEnableToggle ? (
            <Button
              variant="outline"
              onClick={onEnableToggle}
              disabled={pending}
            >
              {plugin?.enabled
                ? t.plugins.actions.disable
                : t.plugins.actions.enable}
            </Button>
          ) : null}
          {onUninstall ? (
            <Button
              variant="destructive"
              onClick={onUninstall}
              disabled={pending}
            >
              {t.plugins.actions.uninstall}
            </Button>
          ) : null}
          {canUse ? (
            <Button onClick={onUse} disabled={pending}>
              {t.plugins.actions.use}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
