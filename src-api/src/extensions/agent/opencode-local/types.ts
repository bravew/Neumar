/**
 * OpenCode Local Agent Types
 */

export interface OpenCodeLocalConfig {
  /** Path to opencode binary (auto-detected if omitted) */
  binaryPath?: string;
  /** Opencode config directory */
  configDir?: string;
  /** Sync API keys from Neumar settings */
  syncAuth: boolean;
  /** Generate Tauri-compatible config (avoid pty features) */
  tauriCompatMode: boolean;
}
