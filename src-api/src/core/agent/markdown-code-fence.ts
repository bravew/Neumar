export function isInsideMarkdownCodeFence(
  buffer: string,
  index: number,
  initiallyOpen: boolean,
): boolean {
  return updateMarkdownCodeFenceState(initiallyOpen, buffer.slice(0, index));
}

export function updateMarkdownCodeFenceState(
  open: boolean,
  text: string,
): boolean {
  let next = open;
  const matches = text.match(/^```/gm);
  for (let i = 0; i < (matches?.length ?? 0); i++) next = !next;
  return next;
}
