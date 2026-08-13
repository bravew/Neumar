import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface TailscaleStatus {
  available: boolean;
  selfDnsName?: string;
}

export async function detectTailscale(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync('tailscale', [
      'status',
      '--peers=false',
      '--self',
      '--json',
    ]);
    const parsed = JSON.parse(stdout) as {
      Self?: { DNSName?: string };
    };
    return {
      available: true,
      selfDnsName: parsed.Self?.DNSName,
    };
  } catch {
    return { available: false };
  }
}
