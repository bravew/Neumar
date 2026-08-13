export type ComposerKeyboardEventLike = {
  keyCode?: number;
  which?: number;
  nativeEvent?: {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
  };
};

export function isImeCompositionKeyEvent(event: ComposerKeyboardEventLike) {
  return (
    event.nativeEvent?.isComposing === true ||
    event.keyCode === 229 ||
    event.which === 229 ||
    event.nativeEvent?.keyCode === 229 ||
    event.nativeEvent?.which === 229
  );
}
