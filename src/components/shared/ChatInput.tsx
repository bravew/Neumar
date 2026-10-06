import { useCallback, useEffect, useMemo, useRef } from 'react';

import { AnimatePresence } from 'motion/react';

import { canAttachLocalPaths } from '@/shared/lib/local-path';
import { cn } from '@/shared/lib/utils';

import { isImeCompositionKeyEvent } from './chat-input-keyboard';
import type { ChatInputProps } from './ChatInput.types';
import { DEFAULT_ATTACHMENT_ACCEPT, inTauri } from './ChatInput.types';
import { ChatInputActions } from './ChatInputActions';
import { ChatInputAttachmentDialogs } from './ChatInputAttachmentDialogs';
import { AttachmentPreview, DragOverlay } from './ChatInputAttachments';
import { McpChips, SkillChips } from './ChatInputChips';
import { ChatInputTextarea } from './ChatInputTextarea';
import { SlashCommandMenu } from './SlashCommandMenu';
import { useAssetCatalogAttachment } from './useAssetCatalogAttachment';
import { useAttachByPath } from './useAttachByPath';
import { useChatInputFiles } from './useChatInputFiles';
import { useChatInputState } from './useChatInputState';
import { useChatInputSubmit } from './useChatInputSubmit';
import { useCloudStorageAttachment } from './useCloudStorageAttachment';
import {
  useComposerModelShortcut,
  useComposerPlaceholder,
  useComposerTextareaResize,
} from './useComposerInputChrome';

export { DEFAULT_MODEL_ID } from './ChatInput.types';

export function ChatInput({
  placeholder,
  isRunning = false,
  onSubmit,
  onStop,
  variant = 'reply',
  className,
  inputBoxClassName,
  disabled = false,
  autoFocus = false,
  workDir,
  onWorkDirChange,
  workDirs: workDirsProp,
  onWorkDirsChange: onWorkDirsChangeProp,
  showFolderPicker = false,
  attachmentPolicy,
  beforeInput,
  hasExternalSubmitContext = false,
  preserveAttachmentFiles = false,
  selectedModel,
  onModelChange,
  initialValue,
  initialValueNonce,
  taskId,
  onClearMessages,
  initialMcpServers,
  initialSkills,
  onDispatch,
}: ChatInputProps) {
  const effectiveWorkDirs = useMemo(
    () => workDirsProp ?? (workDir ? [workDir] : []),
    [workDirsProp, workDir],
  );
  const handleWorkDirsChange = useCallback(
    (folders: string[]) => {
      if (onWorkDirsChangeProp) {
        onWorkDirsChangeProp(folders);
      } else if (onWorkDirChange) {
        onWorkDirChange(folders[0] ?? null);
      }
    },
    [onWorkDirsChangeProp, onWorkDirChange],
  );

  const attachmentAccept =
    attachmentPolicy?.accept ?? DEFAULT_ATTACHMENT_ACCEPT;
  const effectiveWorkDirsRef = useRef(effectiveWorkDirs);
  effectiveWorkDirsRef.current = effectiveWorkDirs;

  const {
    attachments,
    setAttachments,
    addFiles,
    attachLocalPaths,
    isDragOver,
    fileInputRef,
    pendingDropFolders,
    dropFolderDialogOpen,
    removeAttachment,
    handleFileChange,
    handlePaste,
    openFilePicker,
    handleDropFolderDialogResult,
    handleOpenWorkDir: openWorkDir,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
  } = useChatInputFiles({
    disabled,
    effectiveWorkDirsRef,
    handleWorkDirsChange,
    acceptsFile: attachmentPolicy?.acceptsFile,
    // Desktop: pick by path so files are read in place, not uploaded.
    // Callers that need the bytes (preserveAttachmentFiles) keep the input.
    nativePickerAccept:
      inTauri && !preserveAttachmentFiles ? attachmentAccept : undefined,
  });

  const {
    t,
    value,
    setValue,
    partialText,
    mcpServers,
    selectedMcp,
    setSelectedMcp,
    mcpPopoverOpen,
    setMcpPopoverOpen,
    mcpMentionFilter,
    setMcpMentionFilter,
    availableSkills,
    selectedSkills,
    setSelectedSkills,
    slashMenuOpen,
    slashSearch,
    modelTriggerRef,
    textareaRef,
    isComposingRef,
    handleMcpToggle,
    removeMcpServer,
    handleSkillToggle,
    removeSkill,
    currentSettings,
    modelOptions,
    activeModelId,
    activeModelLabel,
    isListening,
    startListening,
    stopListening,
    handleMicToggle,
    convertToMessageAttachments,
    handleTextareaChange,
    handleCompositionStart,
    handleCompositionEnd,
    handleSlashSelect,
    handleSlashClose,
    buildSlashActions,
  } = useChatInputState({
    initialMcpServers,
    initialSkills,
    selectedModel,
    isRunning,
    autoFocus,
    initialValue,
    initialValueNonce,
    preserveAttachmentFiles,
  });
  const { cloudPickerOpen, setCloudPickerOpen, handleCloudStorageSelect } =
    useCloudStorageAttachment({
      addFiles,
      setValue,
    });
  const { assetCatalogOpen, setAssetCatalogOpen, handleAssetCatalogSelect } =
    useAssetCatalogAttachment({ addFiles });
  const { attachByPathOpen, setAttachByPathOpen } = useAttachByPath(disabled);

  const isHome = variant === 'home';
  const resolvedPlaceholder = useComposerPlaceholder(
    placeholder,
    t.home.chatInputDefaultPlaceholder,
  );
  const pttKey = currentSettings.speech?.sttPttKey || 'Space';
  const pttActiveRef = useRef(false);
  const canSubmit =
    (value.trim().length > 0 ||
      attachments.length > 0 ||
      hasExternalSubmitContext) &&
    !disabled;
  const displayValue =
    isListening && partialText
      ? value
        ? `${value} ${partialText}`
        : partialText
      : value;

  const { handleSubmit, handleDispatch } = useChatInputSubmit({
    value,
    setValue,
    attachments,
    setAttachments,
    selectedMcp,
    setSelectedMcp,
    selectedSkills,
    setSelectedSkills,
    convertToMessageAttachments,
    hasExternalSubmitContext,
    disabled,
    isListening,
    stopListening,
    pttActiveRef,
    onSubmit,
    onDispatch,
  });

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const composingKey = isComposingRef.current || isImeCompositionKeyEvent(e);

    if (
      slashMenuOpen &&
      ['Enter', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)
    )
      return;

    if (e.key === 'Escape' && isListening) {
      e.preventDefault();
      pttActiveRef.current = false;
      stopListening();
      return;
    }

    const canPushToTalk =
      currentSettings.speech?.sttEnabled &&
      !disabled &&
      !isRunning &&
      !composingKey &&
      value.trim().length === 0 &&
      attachments.length === 0;

    if (e.code === pttKey && !e.repeat && canPushToTalk) {
      e.preventDefault();
      pttActiveRef.current = true;
      void startListening().catch(() => {
        pttActiveRef.current = false;
      });
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey && !composingKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  useComposerTextareaResize({ textareaRef, isHome, value });

  useEffect(() => {
    const handleKeyUp = (event: KeyboardEvent) => {
      if (!pttActiveRef.current || event.code !== pttKey) return;
      event.preventDefault();
      pttActiveRef.current = false;
      stopListening();
    };

    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [pttKey, stopListening]);

  useEffect(() => {
    if (!pttActiveRef.current) return;
    if (!disabled && !isRunning) return;
    pttActiveRef.current = false;
    stopListening();
  }, [disabled, isRunning, stopListening]);

  useComposerModelShortcut({
    disabled,
    isRunning,
    enabled: Boolean(onModelChange),
    triggerRef: modelTriggerRef,
  });

  return (
    <div className={cn('relative w-full', className)}>
      <AnimatePresence>
        {isDragOver && (
          <DragOverlay isHome={isHome} label={t.home.addFilesOrPhotos} />
        )}
      </AnimatePresence>

      <div
        data-testid="chat-input"
        className={cn(
          'relative w-full transition-all',
          isHome
            ? 'border-border/50 bg-background rounded-2xl border p-4 shadow-lg'
            : 'border-border/60 bg-background rounded-xl border px-3 py-2 shadow-sm',
          isDragOver && 'opacity-50',
          inputBoxClassName,
        )}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={attachmentAccept}
          onChange={handleFileChange}
          className="hidden"
        />

        {beforeInput ? <div className="mb-2">{beforeInput}</div> : null}
        <AttachmentPreview
          attachments={attachments}
          onRemove={removeAttachment}
        />
        <McpChips
          selected={selectedMcp}
          servers={mcpServers}
          onRemove={removeMcpServer}
        />
        <SkillChips
          selected={selectedSkills}
          skills={availableSkills}
          onRemove={removeSkill}
        />

        <SlashCommandMenu
          open={slashMenuOpen}
          search={slashSearch}
          actions={buildSlashActions({ onClear: onClearMessages, taskId })}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />

        <ChatInputTextarea
          textareaRef={textareaRef}
          value={displayValue}
          onChange={handleTextareaChange}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onPaste={handlePaste}
          placeholder={resolvedPlaceholder}
          isHome={isHome}
          disabled={disabled}
        />

        <ChatInputActions
          isHome={isHome}
          isRunning={isRunning}
          disabled={disabled}
          canSubmit={canSubmit}
          openFilePicker={openFilePicker}
          openCloudStoragePicker={() => setCloudPickerOpen(true)}
          openAssetCatalogPicker={() => setAssetCatalogOpen(true)}
          openAttachByPath={
            canAttachLocalPaths() ? () => setAttachByPathOpen(true) : undefined
          }
          addFilesLabel={t.home.addFilesOrPhotos}
          addCloudStorageLabel={t.cloudStorage.cloudStoragePickerLabel}
          addAssetCatalogLabel={t.assets.browseCatalog}
          allowCloudStorage={attachmentPolicy?.allowCloudStorage ?? true}
          allowAssetCatalog={attachmentPolicy?.allowAssetCatalog ?? true}
          showFolderPicker={showFolderPicker}
          hasFolderChangeHandler={!!(onWorkDirsChangeProp || onWorkDirChange)}
          effectiveWorkDirs={effectiveWorkDirs}
          handleWorkDirsChange={handleWorkDirsChange}
          mcpServers={mcpServers}
          selectedMcp={selectedMcp}
          handleMcpToggle={handleMcpToggle}
          mcpPopoverOpen={mcpPopoverOpen}
          onMcpPopoverClose={() => {
            setMcpPopoverOpen(false);
            setMcpMentionFilter('');
          }}
          mcpMentionFilter={mcpMentionFilter}
          availableSkills={availableSkills}
          selectedSkills={selectedSkills}
          handleSkillToggle={handleSkillToggle}
          workDir={workDir}
          handleOpenWorkDir={() => openWorkDir(workDir)}
          selectedFolderLabel={t.home.selectedFolder}
          onModelChange={onModelChange}
          modelOptions={modelOptions}
          activeModelId={activeModelId}
          activeModelLabel={activeModelLabel}
          modelTriggerRef={modelTriggerRef}
          sttEnabled={!!currentSettings.speech?.sttEnabled}
          isListening={isListening}
          handleMicToggle={handleMicToggle}
          handleSubmit={handleSubmit}
          onStop={onStop}
          onDispatch={onDispatch ? handleDispatch : undefined}
        />
      </div>

      <ChatInputAttachmentDialogs
        cloudPickerOpen={cloudPickerOpen}
        assetCatalogOpen={assetCatalogOpen}
        attachByPathOpen={attachByPathOpen}
        dropFolderDialogOpen={dropFolderDialogOpen}
        pendingDropFolder={pendingDropFolders[0]}
        setCloudPickerOpen={setCloudPickerOpen}
        setAssetCatalogOpen={setAssetCatalogOpen}
        setAttachByPathOpen={setAttachByPathOpen}
        onAttachByPath={attachLocalPaths}
        onDropFolderDialogResult={handleDropFolderDialogResult}
        onCloudSelect={(items) => void handleCloudStorageSelect(items)}
        onAssetCatalogSelect={handleAssetCatalogSelect}
      />
    </div>
  );
}
