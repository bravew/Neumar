export type LibrarySettingsCategory = 'skills' | 'plugins' | 'publish';

export type LibraryTabRedirect =
  | { kind: 'tab'; tab: 'files' }
  | { kind: 'settings'; category: LibrarySettingsCategory };

/**
 * Flag-on homes for the old Library tab query values.
 * `graph` is intentionally left in Library.
 */
export function libraryTabRedirect(
  tab: string | null,
  simpleShell: boolean,
): LibraryTabRedirect | null {
  if (!simpleShell) return null;
  switch (tab) {
    case 'plugins':
      return { kind: 'settings', category: 'skills' };
    case 'marketplace':
      return { kind: 'settings', category: 'plugins' };
    case 'publish':
      return { kind: 'settings', category: 'publish' };
    case 'cloud-storage':
      return { kind: 'tab', tab: 'files' };
    default:
      return null;
  }
}
