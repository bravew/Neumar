/**
 * Custom hook encapsulating MCP, skill, model selection, speech, and slash
 * command state for ChatInput.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useSettingsValue } from '@/shared/db/settings';
import type { MessageAttachment } from '@/shared/hooks/useAgent';
import { useMcpServers } from '@/shared/hooks/useMcpServers';
import { useSkills } from '@/shared/hooks/useSkills';
import { useSpeech } from '@/shared/hooks/useSpeech';
import { useLanguage } from '@/shared/providers/language-provider';

import type { Attachment } from './ChatInput.types';
import { DEFAULT_MODEL_ID, getModelShortLabel } from './ChatInput.types';
import { MAX_PINNED_SKILLS } from './SkillSelector';
import { useModelOptions } from './useModelOptions';

export interface UseChatInputStateOptions {
  initialMcpServers?: string[];
  initialSkills?: string[];
  selectedModel?: string;
  isRunning: boolean;
  autoFocus: boolean;
  initialValue?: string;
  initialValueNonce?: number;
  preserveAttachmentFiles?: boolean;
}

export function useChatInputState({
  initialMcpServers,
  initialSkills,
  selectedModel,
  isRunning,
  autoFocus,
  initialValue,
  initialValueNonce,
  preserveAttachmentFiles = false,
}: UseChatInputStateOptions) {
  const { t } = useLanguage();
  const [value, setValue] = useState('');
  const [partialText, setPartialText] = useState('');

  // ── MCP server selection state ──
  const { servers: mcpServers } = useMcpServers();
  const [selectedMcp, setSelectedMcp] = useState<string[]>(
    initialMcpServers ?? [],
  );
  const [mcpPopoverOpen, setMcpPopoverOpen] = useState(false);
  const [mcpMentionFilter, setMcpMentionFilter] = useState('');

  // ── Skill pinning state ──
  const { skills: availableSkills } = useSkills();
  const [selectedSkills, setSelectedSkills] = useState<string[]>(
    initialSkills ?? [],
  );

  // Sync from external profile changes
  const prevInitialMcpRef = useRef(initialMcpServers);
  const prevInitialSkillsRef = useRef(initialSkills);

  useEffect(() => {
    if (initialMcpServers !== prevInitialMcpRef.current) {
      prevInitialMcpRef.current = initialMcpServers;
      setSelectedMcp(initialMcpServers ?? []);
    }
  }, [initialMcpServers]);

  useEffect(() => {
    if (initialSkills !== prevInitialSkillsRef.current) {
      prevInitialSkillsRef.current = initialSkills;
      setSelectedSkills(initialSkills ?? []);
    }
  }, [initialSkills]);

  // ── Slash command state ──
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashSearch, setSlashSearch] = useState('');
  const modelTriggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const prevIsRunningRef = useRef(isRunning);

  const handleMcpToggle = useCallback(
    (name: string) => {
      setSelectedMcp((prev) =>
        prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
      );
      if (mcpPopoverOpen && mcpMentionFilter !== '') {
        setValue((prev) => prev.replace(/@[\w-]*$/, '').trimEnd());
        setMcpPopoverOpen(false);
        setMcpMentionFilter('');
        setTimeout(() => textareaRef.current?.focus(), 0);
      }
    },
    [mcpPopoverOpen, mcpMentionFilter],
  );

  const removeMcpServer = useCallback((name: string) => {
    setSelectedMcp((prev) => prev.filter((n) => n !== name));
  }, []);

  const handleSkillToggle = useCallback((slug: string) => {
    setSelectedSkills((prev) => {
      if (prev.includes(slug)) return prev.filter((s) => s !== slug);
      if (prev.length >= MAX_PINNED_SKILLS) return prev;
      return [...prev, slug];
    });
  }, []);

  const removeSkill = useCallback((slug: string) => {
    setSelectedSkills((prev) => prev.filter((s) => s !== slug));
  }, []);

  // Reactive settings (folder pickers etc.) + shared mode-scoped catalog
  const currentSettings = useSettingsValue();
  const modelOptions = useModelOptions('task');

  const activeModelId = selectedModel ?? DEFAULT_MODEL_ID;
  const activeModelLabel =
    modelOptions.find((m) => m.id === activeModelId)?.label ??
    getModelShortLabel(activeModelId);

  // Speech integration — STT mic input
  const { isListening, startListening, stopListening } = useSpeech({
    onTranscript: useCallback((text: string) => {
      setPartialText('');
      setValue((prev) => (prev ? `${prev} ${text}` : text));
    }, []),
    onPartialTranscript: useCallback((partial: string) => {
      setPartialText(partial);
    }, []),
  });

  const handleMicToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      setPartialText('');
    } else {
      void startListening();
    }
  }, [isListening, startListening, stopListening]);

  // ── Focus management ──
  useEffect(() => {
    if (autoFocus && textareaRef.current) textareaRef.current.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (initialValueNonce !== undefined && initialValue !== undefined) {
      setValue(initialValue);
      const valueLength = initialValue.length;
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          ta.selectionStart = ta.selectionEnd = valueLength;
        }
      });
    }
  }, [initialValueNonce, initialValue]);

  useEffect(() => {
    if (prevIsRunningRef.current && !isRunning && textareaRef.current) {
      textareaRef.current.focus();
    }
    prevIsRunningRef.current = isRunning;
  }, [isRunning]);

  // ── Submit logic ──
  const convertToMessageAttachments = useCallback(
    (attachments: Attachment[]): MessageAttachment[] | undefined => {
      if (attachments.length === 0) return undefined;
      const result = attachments
        .filter((a) =>
          a.type === 'image' ? !!(a.preview && a.preview.length > 0) : true,
        )
        .map((a) => {
          let mimeType = a.file.type;
          if (!mimeType && a.type === 'image') mimeType = 'image/png';
          return {
            id: a.id,
            type: (a.type === 'image' ? 'image' : 'file') as 'image' | 'file',
            name: a.file.name,
            data: a.preview || '',
            mimeType,
            path: a.localPath,
            file:
              preserveAttachmentFiles || a.type !== 'image'
                ? a.file
                : undefined,
            sourceContext: a.sourceContext,
          };
        });
      return result.length > 0 ? result : undefined;
    },
    [preserveAttachmentFiles],
  );

  const updateSuggestionState = useCallback(
    (newVal: string, cursor: number) => {
      if (mcpServers.length > 0) {
        const textBeforeCursor = newVal.slice(0, cursor);
        const atMatch = textBeforeCursor.match(/(?<![a-zA-Z])@([\w-]*)$/);
        if (atMatch) {
          setMcpMentionFilter(atMatch[1]);
          if (!mcpPopoverOpen) setMcpPopoverOpen(true);
        } else if (mcpPopoverOpen && mcpMentionFilter !== '') {
          setMcpPopoverOpen(false);
          setMcpMentionFilter('');
        }
      }
      const slashMatch = newVal.match(/^\/(\w*)$/);
      if (slashMatch) {
        setSlashSearch(slashMatch[1] ?? '');
        if (!slashMenuOpen) setSlashMenuOpen(true);
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
        setSlashSearch('');
      }
    },
    [mcpServers.length, mcpPopoverOpen, mcpMentionFilter, slashMenuOpen],
  );

  // Handle textarea onChange — detects @mentions and /slash commands
  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value;
      setValue(newVal);
      if (isComposingRef.current) return;
      updateSuggestionState(
        e.target.value,
        e.target.selectionStart ?? newVal.length,
      );
    },
    [updateSuggestionState],
  );

  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(
    (event: React.CompositionEvent<HTMLTextAreaElement>) => {
      const value = event.currentTarget.value;
      const cursor = event.currentTarget.selectionStart ?? value.length;
      setTimeout(() => {
        isComposingRef.current = false;
        updateSuggestionState(value, cursor);
      }, 10);
    },
    [updateSuggestionState],
  );

  // ── Slash command helpers ──
  const handleSlashSelect = useCallback(
    (cmd: { execute: () => void }) => {
      setSlashMenuOpen(false);
      setSlashSearch('');
      setValue('');
      requestAnimationFrame(() => {
        cmd.execute();
        textareaRef.current?.focus();
      });
    },
    [textareaRef],
  );

  const handleSlashClose = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashSearch('');
  }, []);

  const buildSlashActions = useCallback(
    (opts: { onClear?: () => void; taskId?: string }) => ({
      onClear: opts.onClear,
      onModelSelect: () => {
        modelTriggerRef.current?.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
          }),
        );
      },
      onWorkspacePick: () => {
        requestAnimationFrame(() => {
          const btn = document.querySelector(
            '[data-folder-picker-trigger]',
          ) as HTMLButtonElement | null;
          btn?.click();
        });
      },
      onInsertText: (text: string) => {
        setValue(text);
        requestAnimationFrame(() => {
          const ta = textareaRef.current;
          if (!ta) return;
          ta.focus();
          ta.selectionStart = ta.selectionEnd = text.length;
        });
      },
      taskId: opts.taskId,
    }),
    [modelTriggerRef, textareaRef],
  );

  return {
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
    setSlashMenuOpen,
    slashSearch,
    setSlashSearch,
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
  };
}
