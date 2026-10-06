import { useRef, useState } from 'react';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type {
  Attachment,
  ChatInputProps,
} from '@/components/shared/ChatInput.types';
import { useChatInputSubmit } from '@/components/shared/useChatInputSubmit';
import type { MessageAttachment } from '@/shared/hooks/useAgent';

const originalAttachment: Attachment = {
  id: 'original',
  type: 'file',
  file: new File(['draft'], 'draft.txt', { type: 'text/plain' }),
};
const newAttachment: Attachment = {
  id: 'new',
  type: 'file',
  file: new File(['new'], 'new.txt', { type: 'text/plain' }),
};
const messageAttachments: MessageAttachment[] = [
  {
    id: 'original',
    type: 'file',
    name: 'draft.txt',
    data: '',
    file: originalAttachment.file,
  },
];

function renderComposer(onSubmit: ChatInputProps['onSubmit']) {
  return renderHook(() => {
    const [value, setValue] = useState('  original draft  ');
    const [attachments, setAttachments] = useState([originalAttachment]);
    const [selectedMcp, setSelectedMcp] = useState(['files']);
    const [selectedSkills, setSelectedSkills] = useState(['research']);
    const pttActiveRef = useRef(false);
    const handlers = useChatInputSubmit({
      value,
      setValue,
      attachments,
      setAttachments,
      selectedMcp,
      setSelectedMcp,
      selectedSkills,
      setSelectedSkills,
      convertToMessageAttachments: () => messageAttachments,
      hasExternalSubmitContext: false,
      disabled: false,
      isListening: false,
      stopListening: vi.fn(),
      pttActiveRef,
      onSubmit,
      onDispatch: onSubmit,
    });
    return {
      ...handlers,
      value,
      setValue,
      attachments,
      setAttachments,
      selectedMcp,
      setSelectedMcp,
      selectedSkills,
      setSelectedSkills,
    };
  });
}

function deferredSubmit() {
  let resolve!: (sent: boolean) => void;
  const promise = new Promise<boolean>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useChatInputSubmit attachment draft recovery', () => {
  it.each(['handleSubmit', 'handleDispatch'] as const)(
    '%s restores the complete draft when the handler returns false',
    async (handler) => {
      const onSubmit = vi
        .fn<ChatInputProps['onSubmit']>()
        .mockResolvedValue(false);
      const { result } = renderComposer(onSubmit);

      await act(async () => {
        await result.current[handler]();
      });

      expect(onSubmit).toHaveBeenCalledWith(
        'original draft',
        messageAttachments,
        ['files'],
        ['research'],
      );
      expect(result.current.value).toBe('  original draft  ');
      expect(result.current.attachments).toEqual([originalAttachment]);
      expect(result.current.selectedMcp).toEqual(['files']);
      expect(result.current.selectedSkills).toEqual(['research']);
    },
  );

  it('merges the rejected draft with text and attachments added during async submission', async () => {
    const deferred = deferredSubmit();
    const { result } = renderComposer(() => deferred.promise);
    let submission!: Promise<void>;

    act(() => {
      submission = result.current.handleSubmit();
    });
    expect(result.current.value).toBe('');
    expect(result.current.attachments).toEqual([]);

    act(() => {
      result.current.setValue('next message');
      result.current.setAttachments([newAttachment]);
      result.current.setSelectedMcp(['files', 'search']);
      result.current.setSelectedSkills(['research', 'editing']);
    });
    await act(async () => {
      deferred.resolve(false);
      await submission;
    });

    expect(result.current.value).toBe('  original draft  \nnext message');
    expect(result.current.attachments).toEqual([
      originalAttachment,
      newAttachment,
    ]);
    expect(result.current.selectedMcp).toEqual(['files', 'search']);
    expect(result.current.selectedSkills).toEqual(['research', 'editing']);
  });

  it('restores the complete draft when the handler rejects', async () => {
    const error = new Error('attachment upload failed');
    const onSubmit = vi
      .fn<ChatInputProps['onSubmit']>()
      .mockRejectedValue(error);
    const { result } = renderComposer(onSubmit);

    await act(async () => {
      await expect(result.current.handleSubmit()).rejects.toBe(error);
    });

    expect(result.current.value).toBe('  original draft  ');
    expect(result.current.attachments).toEqual([originalAttachment]);
    expect(result.current.selectedMcp).toEqual(['files']);
    expect(result.current.selectedSkills).toEqual(['research']);
  });

  it.each([true, undefined])(
    'clears the sent draft when the handler resolves %s',
    async (sent) => {
      const onSubmit = vi
        .fn<ChatInputProps['onSubmit']>()
        .mockResolvedValue(sent);
      const { result } = renderComposer(onSubmit);

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.value).toBe('');
      expect(result.current.attachments).toEqual([]);
      expect(result.current.selectedMcp).toEqual([]);
      expect(result.current.selectedSkills).toEqual([]);
    },
  );

  it('preserves the next draft when an async submission succeeds', async () => {
    const deferred = deferredSubmit();
    const { result } = renderComposer(() => deferred.promise);
    let submission!: Promise<void>;

    act(() => {
      submission = result.current.handleSubmit();
    });
    act(() => {
      result.current.setValue('next message');
      result.current.setAttachments([newAttachment]);
    });
    await act(async () => {
      deferred.resolve(true);
      await submission;
    });

    expect(result.current.value).toBe('next message');
    expect(result.current.attachments).toEqual([newAttachment]);
  });
});
