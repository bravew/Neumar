import { Check, Copy, Download, Sparkles, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useLanguage } from '@/shared/providers/language-provider';
import type { DesignSkillRecord } from '@/shared/types/design-mode';

import { surfaceLabel } from './constants';

export function SkillSourceModal({
  skill,
  selected,
  creating,
  installPending,
  error,
  onCreate,
  onInstallChange,
  onOpenChange,
  onSelectDefault,
}: {
  skill: DesignSkillRecord | null;
  selected: boolean;
  creating: boolean;
  installPending: boolean;
  error?: string;
  onCreate: (skill: DesignSkillRecord) => void;
  onInstallChange: (skill: DesignSkillRecord) => void;
  onOpenChange: (open: boolean) => void;
  onSelectDefault: (skill: DesignSkillRecord) => void;
}) {
  const { t } = useLanguage();
  const prompt = skill?.od.examplePrompt || skill?.description || '';

  const copySource = () => {
    const source = skill?.content || prompt;
    if (!source) return;
    navigator.clipboard?.writeText(source).catch(() => {});
  };

  return (
    <Dialog open={Boolean(skill)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-3xl">
        {skill && (
          <>
            <DialogHeader>
              <DialogTitle>{skill.name}</DialogTitle>
              <DialogDescription>{skill.description}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-muted rounded px-2 py-1">
                {surfaceLabel(skill.od.surface)}
              </span>
              {skill.od.scenario && (
                <span className="bg-muted rounded px-2 py-1">
                  {skill.od.scenario}
                </span>
              )}
              <span className="bg-muted rounded px-2 py-1">
                {t.design.source}: {skill.source}
              </span>
              <span className="bg-muted rounded px-2 py-1">
                {skill.origin === 'installed'
                  ? t.design.catalogInstalled
                  : t.design.catalogBuiltIn}
              </span>
              {selected && (
                <span className="bg-primary/10 text-primary rounded px-2 py-1">
                  {t.design.defaultSkill}
                </span>
              )}
            </div>
            {prompt && (
              <section className="rounded-md border">
                <div className="border-b px-3 py-2 text-sm font-medium">
                  {t.design.examplePrompt}
                </div>
                <pre className="text-muted-foreground max-h-40 overflow-auto p-3 text-sm whitespace-pre-wrap">
                  {prompt}
                </pre>
              </section>
            )}
            <section className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                {t.design.skillSource}
              </div>
              <pre className="text-muted-foreground max-h-80 overflow-auto p-3 text-sm whitespace-pre-wrap">
                {skill.content || skill.description}
              </pre>
            </section>
            {skill.od.warnings.length > 0 && (
              <section className="rounded-md border p-3">
                <h3 className="text-sm font-medium">{t.design.warnings}</h3>
                <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5 text-sm">
                  {skill.od.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
            {error && <p className="text-destructive text-sm">{error}</p>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" onClick={copySource}>
                <Copy className="size-4" />
                {t.design.copy}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onSelectDefault(skill)}
                disabled={selected}
              >
                <Check className="size-4" />
                {selected ? t.design.defaultSkill : t.design.useAsDefaultSkill}
              </Button>
              {(skill.origin !== 'installed' || skill.canUninstall) && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onInstallChange(skill)}
                  disabled={installPending}
                >
                  {skill.canUninstall ? (
                    <Trash2 className="size-4" />
                  ) : (
                    <Download className="size-4" />
                  )}
                  {installPending
                    ? t.design.catalogUpdating
                    : skill.canUninstall
                      ? t.design.catalogUninstall
                      : t.design.catalogInstall}
                </Button>
              )}
              {skill.origin === 'builtin' && (
                <TooltipProvider delayDuration={0}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground inline-flex items-center rounded-md px-3 py-2 text-sm">
                        {t.design.catalogBuiltIn}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {t.design.catalogBuiltInProtected}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              <Button
                type="button"
                onClick={() => onCreate(skill)}
                disabled={creating}
              >
                <Sparkles className="size-4" />
                {creating ? t.design.creating : t.design.createFromSkill}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
