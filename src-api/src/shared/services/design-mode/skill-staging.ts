import { cp, lstat, rm, stat } from 'node:fs/promises';
import path from 'node:path';

export const DESIGN_SKILLS_CWD_ALIAS = '.neuma-skills';

export interface SkillStagingResult {
  staged: boolean;
  stagedPath?: string;
  aliasPath?: string;
  reason?: string;
}

export type SkillStagingLogger = (message: string) => void;

export async function stageDesignModeSkill(
  cwd: string | null | undefined,
  folderName: string,
  sourceDir: string,
  log: SkillStagingLogger = () => {},
): Promise<SkillStagingResult> {
  if (!cwd) return { staged: false, reason: 'no project cwd' };
  if (!isSafeAliasSegment(folderName)) {
    return { staged: false, reason: `unsafe folder name "${folderName}"` };
  }

  try {
    const sourceStat = await stat(sourceDir);
    if (!sourceStat.isDirectory()) {
      return { staged: false, reason: 'source is not a directory' };
    }
  } catch (error) {
    return {
      staged: false,
      reason: `source missing: ${(error as Error).message}`,
    };
  }

  const aliasRoot = path.join(cwd, DESIGN_SKILLS_CWD_ALIAS);
  const stagedPath = path.join(aliasRoot, folderName);
  const aliasPath = path.posix.join(DESIGN_SKILLS_CWD_ALIAS, folderName);

  try {
    const aliasStat = await lstat(aliasRoot);
    if (aliasStat.isSymbolicLink()) {
      log(
        `[neuma] skill-stage: replacing legacy symlink at ${aliasRoot} with a real directory`,
      );
      await rm(aliasRoot, { recursive: true, force: true });
    } else if (!aliasStat.isDirectory()) {
      log(
        `[neuma] skill-stage: ${aliasRoot} exists and is not a directory; refusing to stage`,
      );
      return {
        staged: false,
        reason: 'alias root taken by a non-directory entry',
      };
    }
  } catch {
    // alias root does not exist yet
  }

  try {
    await rm(stagedPath, { recursive: true, force: true });
    await cp(sourceDir, stagedPath, {
      recursive: true,
      dereference: true,
      preserveTimestamps: true,
    });
    return { staged: true, stagedPath, aliasPath };
  } catch (error) {
    log(`[neuma] skill-stage failed: ${(error as Error).message}`);
    return { staged: false, reason: (error as Error).message };
  }
}

const UNSAFE_ALIAS_RE = /[\\/]/;

function isSafeAliasSegment(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (name.includes('\0')) return false;
  if (UNSAFE_ALIAS_RE.test(name)) return false;
  if (path.isAbsolute(name)) return false;
  return true;
}
