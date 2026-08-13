import type { AgentRuntimeDef } from './types.js';

export const AGENT_PROMPT_TOO_LARGE = 'AGENT_PROMPT_TOO_LARGE';
export const WINDOWS_COMMAND_LINE_LIMIT = 32_767;
export const POSIX_ARGV_PROMPT_LIMIT = 120 * 1024;

type PromptGuardDef = Pick<
  AgentRuntimeDef,
  | 'id'
  | 'name'
  | 'promptDelivery'
  | 'windowsMaxPromptArgBytes'
  | 'maxPromptArgBytes'
>;

export interface PromptGuardFailure {
  ok: false;
  code: typeof AGENT_PROMPT_TOO_LARGE;
  message: string;
}

export interface PromptGuardSuccess {
  ok: true;
}

export type PromptGuardResult = PromptGuardSuccess | PromptGuardFailure;

interface PlatformOption {
  platform?: NodeJS.Platform;
}

export function checkPromptArgvBudget(
  def: PromptGuardDef,
  composedPrompt: string,
  options: PlatformOption = {},
): boolean {
  if (def.promptDelivery !== 'argv') return true;
  const platform = options.platform ?? process.platform;
  const windowsMaxPromptArgBytes =
    def.windowsMaxPromptArgBytes ?? def.maxPromptArgBytes;
  const maxPromptArgBytes =
    platform === 'win32' ? windowsMaxPromptArgBytes : POSIX_ARGV_PROMPT_LIMIT;
  if (!maxPromptArgBytes) return true;
  return Buffer.byteLength(composedPrompt, 'utf-8') <= maxPromptArgBytes;
}

export function checkWindowsCmdShimCommandLineBudget(
  def: PromptGuardDef,
  resolvedBin: string,
  args: string[],
  options: PlatformOption = {},
): boolean {
  const platform = options.platform ?? process.platform;
  if (def.promptDelivery !== 'argv' || platform !== 'win32') return true;
  if (!isWindowsCommandShim(resolvedBin)) return true;
  const inner = [resolvedBin, ...args].map(quoteWindowsCommandArg).join(' ');
  const wrapped = `cmd.exe /d /s /c "${inner}"`;
  return wrapped.length <= WINDOWS_COMMAND_LINE_LIMIT;
}

export function checkWindowsDirectExeCommandLineBudget(
  def: PromptGuardDef,
  resolvedBin: string,
  args: string[],
  options: PlatformOption = {},
): boolean {
  const platform = options.platform ?? process.platform;
  if (def.promptDelivery !== 'argv' || platform !== 'win32') return true;
  if (isWindowsCommandShim(resolvedBin)) return true;
  const commandLine = [resolvedBin, ...args]
    .map(quoteWindowsDirectArg)
    .join(' ');
  return commandLine.length <= WINDOWS_COMMAND_LINE_LIMIT;
}

export function validatePromptDeliveryBudget(
  def: PromptGuardDef,
  resolvedBin: string,
  args: string[],
  composedPrompt: string,
  options: PlatformOption = {},
): PromptGuardResult {
  if (!checkPromptArgvBudget(def, composedPrompt, options)) {
    return promptTooLarge(def);
  }

  const ok = isWindowsCommandShim(resolvedBin)
    ? checkWindowsCmdShimCommandLineBudget(def, resolvedBin, args, options)
    : checkWindowsDirectExeCommandLineBudget(def, resolvedBin, args, options);
  return ok ? { ok: true } : promptTooLarge(def);
}

function promptTooLarge(def: PromptGuardDef): PromptGuardFailure {
  const name = def.name || def.id;
  return {
    ok: false,
    code: AGENT_PROMPT_TOO_LARGE,
    message: `${name} cannot receive this prompt safely as a command-line argument. Reduce skills/design context or pick an adapter with stdin support.`,
  };
}

function isWindowsCommandShim(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith('.cmd') || lower.endsWith('.bat');
}

function quoteWindowsCommandArg(arg: string): string {
  const escaped = arg.replace(/"/g, '""').replace(/%/g, '^%');
  return /[\s"]/.test(escaped) ? `"${escaped}"` : escaped;
}

function quoteWindowsDirectArg(arg: string): string {
  if (arg.length === 0) return '""';
  if (!/[\s"]/.test(arg)) return arg;

  let out = '"';
  let backslashes = 0;
  for (const char of arg) {
    if (char === '\\') {
      backslashes += 1;
    } else if (char === '"') {
      out += '\\'.repeat(backslashes * 2 + 1);
      out += '"';
      backslashes = 0;
    } else {
      out += '\\'.repeat(backslashes);
      out += char;
      backslashes = 0;
    }
  }
  out += '\\'.repeat(backslashes * 2);
  out += '"';
  return out;
}
