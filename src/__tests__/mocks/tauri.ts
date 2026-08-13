import { vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: vi.fn(),
      select: vi.fn().mockResolvedValue([]),
    }),
  },
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readDir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn().mockResolvedValue(undefined),
  disable: vi.fn().mockResolvedValue(undefined),
  isEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    isFocused: vi.fn().mockResolvedValue(true),
    isVisible: vi.fn().mockResolvedValue(true),
    setBadgeCount: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
  })),
}));
