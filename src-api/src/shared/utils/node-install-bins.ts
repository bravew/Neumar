import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export function getNvmNodeBinPaths(home: string): string[] {
  const nvmDir = join(home, '.nvm', 'versions', 'node');
  try {
    if (!existsSync(nvmDir)) return [];
    return readdirSync(nvmDir).map((version) => join(nvmDir, version, 'bin'));
  } catch {
    return [];
  }
}

export function getMiseNodeBinPaths(home: string): string[] {
  const miseNodeDir = join(home, '.local', 'share', 'mise', 'installs', 'node');
  try {
    if (!existsSync(miseNodeDir)) return [];
    return readdirSync(miseNodeDir).map((version) =>
      join(miseNodeDir, version, 'bin'),
    );
  } catch {
    return [];
  }
}

export function getMiseShimBinPaths(home: string): string[] {
  const shimDir = join(home, '.local', 'share', 'mise', 'shims');
  return existsSync(shimDir) ? [shimDir] : [];
}

export function getNodeVersionManagerBinPaths(home: string): string[] {
  return [...getNvmNodeBinPaths(home), ...getMiseNodeBinPaths(home)];
}
