import { openUrl } from '@tauri-apps/plugin-opener';

export async function openExternalUrl(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, '_blank');
  }
}
