/**
 * Bottom action bar for ChatInput.
 * Left side: add-files menu, folder picker, MCP selector, skill selector, workdir badge.
 * Right side: model selector, mic button, submit/stop buttons.
 */

import type { RefObject } from 'react';

import { ArrowUp, FolderOpen, Mic, Rocket, Send, Square } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { DURATION } from '@/config/animation';
import type { McpServerInfo } from '@/shared/hooks/useMcpServers';
import type { SkillInfo } from '@/shared/hooks/useSkills';
import { getFileName } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import type { ModelOption } from './ChatInput.types';
import { ChatInputAttachmentMenu } from './ChatInputAttachmentMenu';
import { InlineWaveformBars } from './ChatInputAttachments';
import { ModelSelector } from './ChatInputModelSelector';
import { ComposerPermissionPicker } from './ComposerPermissionPicker';
import { FolderPicker } from './FolderPicker';
import { McpSelector } from './McpSelector';
import { SkillSelector } from './SkillSelector';

export interface ChatInputActionsProps {
  isHome: boolean;
  isRunning: boolean;
  disabled: boolean;
  canSubmit: boolean;
  // Left side
  openFilePicker: () => void;
  openCloudStoragePicker: () => void;
  openAssetCatalogPicker: () => void;
  addFilesLabel: string;
  addCloudStorageLabel: string;
  addAssetCatalogLabel: string;
  allowCloudStorage?: boolean;
  allowAssetCatalog?: boolean;
  showFolderPicker: boolean;
  hasFolderChangeHandler: boolean;
  effectiveWorkDirs: string[];
  handleWorkDirsChange: (folders: string[]) => void;
  mcpServers: McpServerInfo[];
  selectedMcp: string[];
  handleMcpToggle: (name: string) => void;
  mcpPopoverOpen: boolean;
  onMcpPopoverClose: () => void;
  mcpMentionFilter: string;
  availableSkills: SkillInfo[];
  selectedSkills: string[];
  handleSkillToggle: (slug: string) => void;
  workDir?: string | null;
  handleOpenWorkDir: () => void;
  selectedFolderLabel: string;
  // Right side
  onModelChange?: (modelId: string) => void;
  modelOptions: ModelOption[];
  activeModelId: string;
  activeModelLabel: string;
  modelTriggerRef: RefObject<HTMLButtonElement | null>;
  sttEnabled: boolean;
  isListening: boolean;
  handleMicToggle: () => void;
  handleSubmit: () => void;
  onStop?: () => void;
  /** Dispatch handler for background execution — shown on home variant only */
  onDispatch?: () => void;
}

export function ChatInputActions({
  isHome,
  isRunning,
  disabled,
  canSubmit,
  openFilePicker,
  openCloudStoragePicker,
  openAssetCatalogPicker,
  addFilesLabel,
  addCloudStorageLabel,
  addAssetCatalogLabel,
  allowCloudStorage = true,
  allowAssetCatalog = true,
  showFolderPicker,
  hasFolderChangeHandler,
  effectiveWorkDirs,
  handleWorkDirsChange,
  mcpServers,
  selectedMcp,
  handleMcpToggle,
  mcpPopoverOpen,
  onMcpPopoverClose,
  mcpMentionFilter,
  availableSkills,
  selectedSkills,
  handleSkillToggle,
  workDir,
  handleOpenWorkDir,
  selectedFolderLabel,
  onModelChange,
  modelOptions,
  activeModelId,
  activeModelLabel,
  modelTriggerRef,
  sttEnabled,
  isListening,
  handleMicToggle,
  handleSubmit,
  onStop,
  onDispatch,
}: ChatInputActionsProps) {
  const { t } = useLanguage();
  return (
    <div
      className={cn(
        'flex items-center justify-between',
        isHome ? 'mt-3' : 'mt-1',
      )}
    >
      {/* Left side */}
      <div className="flex items-center gap-1">
        <ChatInputAttachmentMenu
          isHome={isHome}
          disabled={disabled}
          openFilePicker={openFilePicker}
          openCloudStoragePicker={openCloudStoragePicker}
          openAssetCatalogPicker={openAssetCatalogPicker}
          addFilesLabel={addFilesLabel}
          addCloudStorageLabel={addCloudStorageLabel}
          addAssetCatalogLabel={addAssetCatalogLabel}
          allowCloudStorage={allowCloudStorage}
          allowAssetCatalog={allowAssetCatalog}
        />

        {showFolderPicker && hasFolderChangeHandler && (
          <FolderPicker
            selectedFolders={effectiveWorkDirs}
            onFoldersChange={handleWorkDirsChange}
            disabled={isRunning || disabled}
          />
        )}

        {mcpServers.length > 0 && (
          <McpSelector
            servers={mcpServers}
            selected={selectedMcp}
            onToggle={handleMcpToggle}
            disabled={isRunning || disabled}
            compact={!isHome}
            forceOpen={mcpPopoverOpen}
            onClose={onMcpPopoverClose}
            mentionFilter={mcpMentionFilter}
          />
        )}

        {availableSkills.length > 0 && (
          <SkillSelector
            skills={availableSkills}
            selected={selectedSkills}
            onToggle={handleSkillToggle}
            disabled={isRunning || disabled}
            compact={!isHome}
          />
        )}

        {!showFolderPicker && workDir && (
          <button
            type="button"
            onClick={handleOpenWorkDir}
            title={workDir}
            className={cn(
              'border-border/50 bg-muted/50 flex max-w-[220px] items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-colors',
              'hover:bg-accent hover:text-accent-foreground cursor-pointer',
            )}
            aria-label={`${selectedFolderLabel}: ${workDir}`}
          >
            <FolderOpen className="text-muted-foreground size-3.5 shrink-0" />
            <span className="truncate">{getFileName(workDir)}</span>
          </button>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-1">
        {isHome && (
          <ComposerPermissionPicker disabled={disabled} isRunning={isRunning} />
        )}

        {onModelChange && (
          <ModelSelector
            modelOptions={modelOptions}
            activeModelId={activeModelId}
            activeModelLabel={activeModelLabel}
            onModelChange={onModelChange}
            isRunning={isRunning}
            disabled={disabled}
            isHome={isHome}
            triggerRef={modelTriggerRef}
          />
        )}

        {isHome && onDispatch && !isRunning && (
          <button
            type="button"
            onClick={onDispatch}
            disabled={!canSubmit}
            title={t.home.dispatchTooltip}
            className={cn(
              'flex items-center justify-center rounded-full transition-all',
              canSubmit
                ? 'text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer'
                : 'text-muted-foreground/40 cursor-not-allowed',
              'size-8',
            )}
          >
            <Rocket className="size-4" />
          </button>
        )}

        {sttEnabled && (
          <button
            type="button"
            onClick={handleMicToggle}
            disabled={disabled}
            className={cn(
              'flex items-center justify-center gap-1 transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              isListening
                ? 'bg-red-500 text-white hover:bg-red-600'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              isHome
                ? isListening
                  ? 'h-8 rounded-full px-2'
                  : 'size-8 rounded-full'
                : isListening
                  ? 'h-7 rounded-md px-1.5'
                  : 'size-7 rounded-md',
            )}
            aria-label={isListening ? 'Stop recording' : 'Start voice input'}
          >
            <Mic
              className={cn('size-4 shrink-0', isListening && 'animate-pulse')}
            />
            {isListening && <InlineWaveformBars />}
          </button>
        )}

        <AnimatePresence mode="wait">
          {isRunning ? (
            <motion.div
              key="running-actions"
              className="flex items-center gap-1"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: DURATION.fast }}
            >
              {canSubmit && (
                <motion.button
                  type="button"
                  onClick={handleSubmit}
                  className={cn(
                    'bg-foreground text-background hover:bg-foreground/90 flex cursor-pointer items-center justify-center rounded-full transition-all',
                    isHome ? 'size-8' : 'size-7',
                  )}
                  whileTap={{ scale: 0.9 }}
                >
                  {isHome ? (
                    <ArrowUp className="size-4" />
                  ) : (
                    <Send className="size-3" />
                  )}
                </motion.button>
              )}
              <motion.button
                type="button"
                onClick={onStop}
                className={cn(
                  'flex items-center justify-center rounded-full transition-colors',
                  isHome
                    ? 'size-8 bg-red-500 text-white hover:bg-red-600'
                    : 'bg-destructive text-destructive-foreground hover:bg-destructive/90 size-7',
                )}
                whileTap={{ scale: 0.9 }}
              >
                <Square className={isHome ? 'size-3.5' : 'size-3'} />
              </motion.button>
            </motion.div>
          ) : (
            <motion.button
              key="submit"
              type="button"
              data-testid="chat-submit-button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                'flex items-center justify-center rounded-full transition-all',
                canSubmit
                  ? 'bg-foreground text-background hover:bg-foreground/90 cursor-pointer'
                  : 'bg-muted text-muted-foreground cursor-not-allowed',
                isHome ? 'size-8' : 'size-7',
              )}
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              transition={{ duration: DURATION.fast }}
              whileTap={canSubmit ? { scale: 0.9 } : undefined}
            >
              {isHome ? (
                <ArrowUp className="size-4" />
              ) : (
                <Send className="size-3" />
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
