/** Visible composer controls when the simple shell is on. At most five. */
export const SIMPLE_COMPOSER_CONTROLS = [
  'attach',
  'agent',
  'autonomy',
  'mic',
  'send',
] as const;

export function composerControlCount(simpleShell: boolean): number {
  return simpleShell ? SIMPLE_COMPOSER_CONTROLS.length : 9;
}
