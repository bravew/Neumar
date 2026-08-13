import { readdir, readFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import type { MountPoint } from './types';

const NETWORK_FS_TYPES = new Set([
  'cifs',
  'fuse.rclone',
  'fuse.sshfs',
  'nfs',
  'nfs4',
  'smbfs',
  'webdav',
]);

export interface DiscoverMountsOptions {
  platform?: NodeJS.Platform;
  readFileText?: (filePath: string) => Promise<string>;
  readDirNames?: (dirPath: string) => Promise<string[]>;
}

export async function discoverNetworkMounts(
  options: DiscoverMountsOptions = {},
): Promise<MountPoint[]> {
  const platform = options.platform ?? os.platform();
  const readFileText =
    options.readFileText ?? ((filePath) => readFile(filePath, 'utf8'));
  const readDirNames = options.readDirNames ?? readdir;

  if (platform === 'linux') {
    return discoverLinuxMounts(readFileText);
  }
  if (platform === 'darwin') {
    return discoverMacMounts(readDirNames);
  }
  if (platform === 'win32') {
    return discoverWindowsMounts();
  }
  return [];
}

export async function discoverLinuxMounts(
  readFileText: (filePath: string) => Promise<string>,
): Promise<MountPoint[]> {
  const content = await readFileText('/proc/self/mountinfo');
  return content
    .split('\n')
    .filter(Boolean)
    .map(parseMountInfoLine)
    .filter(
      (mount): mount is MountPoint =>
        mount !== undefined &&
        mount.fsType !== undefined &&
        NETWORK_FS_TYPES.has(mount.fsType),
    );
}

async function discoverMacMounts(
  readDirNames: (dirPath: string) => Promise<string[]>,
): Promise<MountPoint[]> {
  try {
    const names = await readDirNames('/Volumes');
    return names
      .filter((name) => name !== 'Macintosh HD')
      .map((name) => ({
        path: path.join('/Volumes', name),
        label: name,
      }));
  } catch {
    return [];
  }
}

async function discoverWindowsMounts(): Promise<MountPoint[]> {
  return [];
}

function parseMountInfoLine(line: string): MountPoint | undefined {
  const separatorIndex = line.indexOf(' - ');
  if (separatorIndex === -1) return undefined;

  const preamble = line.slice(0, separatorIndex).split(' ');
  const postamble = line.slice(separatorIndex + 3).split(' ');
  const encodedMountPath = preamble[4];
  if (!encodedMountPath) return undefined;

  const mountPath = decodeMountPath(encodedMountPath);
  const fsType = postamble[0];
  const source = postamble[1];

  if (!mountPath || !fsType) return undefined;
  return { path: mountPath, fsType, source };
}

function decodeMountPath(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  );
}
