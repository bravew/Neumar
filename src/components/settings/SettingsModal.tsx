import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';

import {
  saveSettings,
  syncSettingsWithBackend,
  useSettingsValue,
  type Settings as SettingsType,
} from '@/shared/db/settings';
import {
  getAppDataDir,
  getDisplayPath,
  getMcpConfigPath,
  getSkillsDir,
} from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { findNavItem } from './navigation';
import { SettingsContent } from './SettingsContent';
import { SettingsNav } from './SettingsNav';
import type { SettingsCategory } from './types';

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialCategory?: SettingsCategory;
}

export function SettingsModal({
  open,
  onOpenChange,
  initialCategory,
}: SettingsModalProps) {
  const settings = useSettingsValue();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    initialCategory || 'account',
  );

  // Sync activeCategory when initialCategory changes (e.g., from slash commands)
  useEffect(() => {
    if (initialCategory && open) {
      setActiveCategory(initialCategory);
    }
  }, [initialCategory, open]);

  // Allow deep children (e.g. the plugin marketplace "Use" action) to close the
  // modal before navigating away.
  useEffect(() => {
    if (!open) return;
    const close = () => onOpenChange(false);
    window.addEventListener('close-settings', close);
    return () => window.removeEventListener('close-settings', close);
  }, [open, onOpenChange]);

  const [defaultPaths, setDefaultPaths] = useState({
    workDir: '',
    mcpConfigPath: '',
    skillsPath: '',
  });
  const { t } = useLanguage();

  // Load default paths on mount
  useEffect(() => {
    let mounted = true;
    async function loadDefaultPaths() {
      const [workDir, mcpConfigPath, skillsPath] = await Promise.all([
        getAppDataDir().then(getDisplayPath),
        getMcpConfigPath().then(getDisplayPath),
        getSkillsDir().then(getDisplayPath),
      ]);
      if (mounted) {
        setDefaultPaths({ workDir, mcpConfigPath, skillsPath });
      }
    }
    loadDefaultPaths();
    return () => {
      mounted = false;
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onOpenChange]);

  const handleSettingsChange = useCallback(
    (newSettings: SettingsType) => {
      saveSettings(newSettings);
      const s = t.settings as Record<string, string>;
      toast.success(s.toastSettingsSaved ?? 'Settings saved');
      // Local save is authoritative; backend sync is best-effort
      syncSettingsWithBackend().catch((error) => {
        if (import.meta.env.DEV)
          console.error('[Settings] Failed to sync with backend:', error);
      });
    },
    [t],
  );

  const settingsLabels = t.settings as Record<string, string>;
  const activeItem = findNavItem(activeCategory);

  // Portal to document.body so the modal escapes any ancestor containing
  // block (e.g. the sidebar's `view-transition-name`, which would otherwise
  // pin `position: fixed` to the sidebar's 288px width).
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          data-testid="settings-modal"
          className="bg-background fixed inset-0 z-50 flex flex-col"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          <div className="flex h-full min-h-0">
            <SettingsNav
              activeCategory={activeCategory}
              onSelectCategory={setActiveCategory}
              onClose={() => onOpenChange(false)}
            />

            {/* Right Content */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Header */}
              <div className="flex shrink-0 items-center justify-between px-8 pt-5 pb-3">
                <h2
                  data-testid="settings-active-category"
                  className="text-foreground text-lg font-semibold"
                >
                  {settingsLabels[activeItem.labelKey] ?? activeItem.labelKey}
                </h2>
              </div>

              {/* Sub-tabs for merged categories */}
              {activeItem.categories.length > 1 ? (
                <div className="border-border flex shrink-0 items-center gap-6 border-b px-8">
                  {activeItem.categories.map((category) => (
                    <button
                      key={category}
                      data-testid={`settings-subtab-${category}`}
                      onClick={() => setActiveCategory(category)}
                      className={cn(
                        'relative cursor-pointer py-2.5 text-sm font-medium transition-colors',
                        activeCategory === category
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {t.settings[category]}
                      {activeCategory === category && (
                        <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="border-border shrink-0 border-b" />
              )}

              <SettingsContent
                activeCategory={activeCategory}
                settings={settings}
                onSettingsChange={handleSettingsChange}
                defaultPaths={defaultPaths}
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
