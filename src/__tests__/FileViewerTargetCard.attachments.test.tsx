import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FileViewerTargetCard } from '@/components/design/FileViewerTargetCard';

import { renderWithProviders } from './helpers/render-with-providers';

const labels = {
  close: 'Close',
  pinHeader: 'Pin · at {x}, {y}',
  targetedChangePlaceholder: 'Describe the targeted change...',
  commentPlaceholder: 'Write a comment for this element...',
  comment: 'Comment',
  saving: 'Saving',
  sendToChat: 'Send to chat',
  send: 'Send',
  attachmentDropzone: 'Drop or paste images here. Add notes before posting.',
  attachmentChooseImage: 'Attach image',
  attachmentAddNote: 'Add note',
  attachmentNotePlaceholder: 'Add an attachment note...',
  attachmentRemove: 'Remove attachment',
  attachmentImageAlt: 'Alt text for {name}',
  attachmentLimit: 'Up to 8 attachments per comment.',
  attachmentImageTooLarge: 'Images must be 2 MB or smaller.',
  attachmentImageUnsupported: 'Use PNG, JPG, WebP, or GIF images.',
  attachmentImageReadFailed: 'Could not read that image.',
  commentImageAttachmentLabel: 'Image attachment · {size}',
  commentNoteAttachmentLabel: 'Note',
};

describe('FileViewerTargetCard comment attachments', () => {
  it('submits picked image and note attachments with the comment', async () => {
    const user = userEvent.setup();
    const onSubmitComment = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <FileViewerTargetCard
        target={{
          kind: 'neuma-target',
          id: 'hero',
          label: 'Hero',
          tagName: 'section',
        }}
        filePath="artifacts/index.html"
        mode="comment"
        text="Tighten this section."
        saving={false}
        labels={labels}
        onTextChange={vi.fn()}
        onClose={vi.fn()}
        onSubmitEdit={vi.fn()}
        onSubmitComment={onSubmitComment}
      />,
    );

    await user.upload(
      screen.getByLabelText('Attach image'),
      new File(['image-bytes'], 'screenshot.png', { type: 'image/png' }),
    );
    await screen.findByText('screenshot.png');
    await user.type(
      screen.getByLabelText('Alt text for screenshot.png'),
      'Hero screenshot',
    );

    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await user.type(
      screen.getByPlaceholderText('Add an attachment note...'),
      'Check mobile crop.',
    );
    await user.click(screen.getByRole('button', { name: 'Send to chat' }));

    await waitFor(() => expect(onSubmitComment).toHaveBeenCalledTimes(1));
    expect(onSubmitComment).toHaveBeenCalledWith(
      true,
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          name: 'screenshot.png',
          mime: 'image/png',
          alt: 'Hero screenshot',
          dataUrl: expect.stringMatching(/^data:image\/png;base64,/),
        }),
        expect.objectContaining({
          kind: 'note',
          text: 'Check mobile crop.',
        }),
      ]),
    );
  });

  it('accepts dropped and pasted image attachments', async () => {
    const user = userEvent.setup();
    const onSubmitComment = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <FileViewerTargetCard
        target={{
          kind: 'neuma-target',
          id: 'hero',
          label: 'Hero',
          tagName: 'section',
        }}
        filePath="artifacts/index.html"
        mode="comment"
        text="Use these references."
        saving={false}
        labels={labels}
        onTextChange={vi.fn()}
        onClose={vi.fn()}
        onSubmitEdit={vi.fn()}
        onSubmitComment={onSubmitComment}
      />,
    );

    const dropzone = screen.getByRole('group', {
      name: labels.attachmentDropzone,
    });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(['drop'], 'dropped.png', { type: 'image/png' })],
      },
    });
    await screen.findByText('dropped.png');

    fireEvent.paste(dropzone, {
      clipboardData: {
        files: [new File(['paste'], 'pasted.webp', { type: 'image/webp' })],
      },
    });
    await screen.findByText('pasted.webp');

    await user.click(screen.getByRole('button', { name: 'Send to chat' }));
    await waitFor(() => expect(onSubmitComment).toHaveBeenCalledTimes(1));
    expect(onSubmitComment).toHaveBeenCalledWith(
      true,
      expect.arrayContaining([
        expect.objectContaining({ kind: 'image', name: 'dropped.png' }),
        expect.objectContaining({ kind: 'image', name: 'pasted.webp' }),
      ]),
    );
  });
});
