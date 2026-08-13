import { createFile, type FileType } from '@/shared/db';
import { getFileName, resolveArtifactPath } from '@/shared/lib/paths';

import {
  DETECTABLE_FILE_EXT,
  DETECTABLE_FILE_EXT_WITH_HTML,
  FILE_PREVIEW_LENGTH,
  TITLE_TRUNCATION_LENGTH,
} from './agent-constants';

// Module-level regex constants for MCP media extraction (CLAUDE.md: extract regex to module scope)
const MCP_LOCAL_PATH_RE = /Saved to:\s*(\/[^\s\n]+)/;
const MCP_LOCAL_PATH_RE_G = /Saved to:\s*(\/[^\s\n]+)/g;
const MCP_MEDIA_URL_RE =
  /https?:\/\/[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|svg|mp4|webm|mp3|wav)(?:\?[^\s"'<>]*)?/gi;

// Helper to determine file type from file extension
export function getFileTypeFromPath(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  // Code files
  if (
    [
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'go',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'hpp',
      'cs',
      'rb',
      'php',
      'swift',
      'kt',
      'scala',
      'sh',
      'bash',
      'zsh',
      'ps1',
      'sql',
    ].includes(ext)
  ) {
    return 'code';
  }

  // Image files
  if (
    ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico'].includes(ext)
  ) {
    return 'image';
  }

  // Presentation files
  if (['ppt', 'pptx', 'key', 'odp'].includes(ext)) {
    return 'presentation';
  }

  // Spreadsheet files
  if (['xls', 'xlsx', 'numbers', 'ods'].includes(ext)) {
    return 'spreadsheet';
  }

  // Document files (includes PDF)
  if (['pdf', 'md', 'doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) {
    return 'document';
  }

  // Text files (config, data)
  if (
    [
      'json',
      'yaml',
      'yml',
      'xml',
      'toml',
      'ini',
      'conf',
      'cfg',
      'env',
      'csv',
      'tsv',
    ].includes(ext)
  ) {
    return 'text';
  }

  // Audio files
  if (['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a', 'wma'].includes(ext)) {
    return 'audio';
  }

  // Video files
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'flv'].includes(ext)) {
    return 'video';
  }

  // HTML files
  if (['html', 'htm'].includes(ext)) {
    return 'website';
  }

  // Default to text
  return 'text';
}

// Extract file paths from text content (for text messages that mention file paths)
export async function extractFilesFromText(
  taskId: string,
  textContent: string,
  workingDir?: string,
): Promise<void> {
  if (!textContent) return;

  try {
    // Patterns to match file paths in text
    const filePatterns = [
      // Match paths in backticks
      new RegExp(`\`([^\`]+\\.(?:${DETECTABLE_FILE_EXT}))\``, 'gi'),
      // Match absolute paths with Chinese/unicode support
      new RegExp(
        `(\\/[^\\s"'\`\\n]*[\\u4e00-\\u9fff][^\\s"'\`\\n]*\\.(?:${DETECTABLE_FILE_EXT}))`,
        'gi',
      ),
      // Match standard absolute paths
      new RegExp(
        `(\\/(?:Users|home|tmp|var)[^\\s"'\`\\n]+\\.(?:${DETECTABLE_FILE_EXT}))`,
        'gi',
      ),
    ];

    const detectedFiles = new Set<string>();

    for (const pattern of filePatterns) {
      const matches = textContent.matchAll(pattern);
      for (const match of matches) {
        const rawPath = match[1] || match[0];
        if (!rawPath) continue;
        const filePath = resolveArtifactPath(rawPath, workingDir);
        if (!detectedFiles.has(filePath)) {
          detectedFiles.add(filePath);
          const fileName = getFileName(filePath);
          const fileType = getFileTypeFromPath(filePath);

          await createFile({
            task_id: taskId,
            name: fileName,
            type: fileType,
            path: filePath,
            preview: `File mentioned in response`,
          });
          if (import.meta.env.DEV) {
            console.warn(
              '[useAgent] Created file record from text message:',
              fileName,
            );
          }
        }
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[useAgent] Failed to extract files from text:', error);
    }
  }
}

// Extract file info from tool use messages and create file records
export async function extractAndSaveFiles(
  taskId: string,
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  toolOutput: string | undefined,
  workingDir?: string,
): Promise<void> {
  if (!toolInput) return;

  try {
    // Handle Write tool - creates new files
    if (toolName === 'Write' && toolInput.file_path) {
      const filePath = resolveArtifactPath(
        String(toolInput.file_path),
        workingDir,
      );
      const fileName = getFileName(filePath);
      const content = toolInput.content ? String(toolInput.content) : '';
      const preview = content.slice(0, FILE_PREVIEW_LENGTH);
      const fileType = getFileTypeFromPath(filePath);

      await createFile({
        task_id: taskId,
        name: fileName,
        type: fileType,
        path: filePath,
        preview: preview || undefined,
      });
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Created file record for Write:', fileName);
      }
    }

    // Handle Edit tool - modifies existing files
    if (toolName === 'Edit' && toolInput.file_path) {
      const filePath = resolveArtifactPath(
        String(toolInput.file_path),
        workingDir,
      );
      const fileName = getFileName(filePath);
      const newContent = toolInput.new_string
        ? String(toolInput.new_string)
        : '';
      const fileType = getFileTypeFromPath(filePath);

      await createFile({
        task_id: taskId,
        name: `${fileName} (edited)`,
        type: fileType,
        path: filePath,
        preview: newContent.slice(0, FILE_PREVIEW_LENGTH) || undefined,
      });
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Created file record for Edit:', fileName);
      }
    }

    // Handle WebFetch tool - captures web content
    if (toolName === 'WebFetch' && toolInput.url) {
      const url = String(toolInput.url);
      const title = url
        .replace(/^https?:\/\//, '')
        .slice(0, TITLE_TRUNCATION_LENGTH);

      await createFile({
        task_id: taskId,
        name: title,
        type: 'website',
        path: url,
        preview: toolOutput?.slice(0, FILE_PREVIEW_LENGTH) || undefined,
      });
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Created file record for WebFetch:', title);
      }
    }

    // Handle WebSearch tool - captures search results
    if (toolName === 'WebSearch' && toolInput.query) {
      const query = String(toolInput.query);

      await createFile({
        task_id: taskId,
        name: `Search: ${query.slice(0, 50)}`,
        type: 'text',
        path: `search://${encodeURIComponent(query)}`,
        preview: toolOutput?.slice(0, FILE_PREVIEW_LENGTH) || undefined,
      });
      if (import.meta.env.DEV) {
        console.warn('[useAgent] Created file record for WebSearch:', query);
      }
    }

    // Handle Bash tool and sandbox_run_script - capture command outputs and detect generated files
    if (
      (toolName === 'Bash' || toolName === 'sandbox_run_script') &&
      (toolInput.command || toolInput.script)
    ) {
      const command = String(toolInput.command || toolInput.script || '');
      const detectedBashFiles = new Set<string>();

      // Check if this is a file generation command
      const filePatterns = [
        new RegExp(
          `saved?\\s+(?:to\\s+)?["']?([^\\s"']+\\.(?:${DETECTABLE_FILE_EXT}))["']?`,
          'gi',
        ),
        new RegExp(
          `(?:created|generated|wrote|output)\\s+["']?([^\\s"']+\\.(?:${DETECTABLE_FILE_EXT}))["']?`,
          'gi',
        ),
        new RegExp(
          `writeFile\\s*\\(\\s*["']([^"']+\\.(?:${DETECTABLE_FILE_EXT}))["']`,
          'gi',
        ),
        // Match any absolute path
        new RegExp(`(\\/[^\\s"'\`\\n]+\\.(?:${DETECTABLE_FILE_EXT}))`, 'gi'),
        // Match paths in backticks
        new RegExp(`\`([^\`]+\\.(?:${DETECTABLE_FILE_EXT}))\``, 'gi'),
      ];

      if (toolOutput) {
        for (const pattern of filePatterns) {
          const matches = toolOutput.matchAll(pattern);
          for (const match of matches) {
            const rawPath = match[1] || match[0];
            if (!rawPath) continue;
            const filePath = resolveArtifactPath(rawPath, workingDir);
            if (!detectedBashFiles.has(filePath)) {
              detectedBashFiles.add(filePath);
              const fileName = getFileName(filePath);
              const fileType = getFileTypeFromPath(filePath);

              await createFile({
                task_id: taskId,
                name: fileName,
                type: fileType,
                path: filePath,
                preview: `Generated by command: ${command.slice(0, 100)}`,
              });
              if (import.meta.env.DEV) {
                console.warn(
                  '[useAgent] Created file record for generated file:',
                  fileName,
                );
              }
            }
          }
        }
      }
    }

    // Handle Skill tool - capture skill outputs and detect generated files
    if (toolName === 'Skill' && toolOutput) {
      // Try to detect file paths in skill output (includes html for Skill outputs)
      const filePatterns = [
        new RegExp(
          `(?:saved?|created|generated|wrote|output)\\s+(?:to\\s+)?["']?([^\\s"'\\n]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))["']?`,
          'gi',
        ),
        new RegExp(
          `(?:file|output|presentation|document):\\s*["']?([^\\s"'\\n]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))["']?`,
          'gi',
        ),
        // Match any absolute path
        new RegExp(
          `(\\/[^\\s"'\`\\n]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))`,
          'gi',
        ),
        // Match paths in backticks
        new RegExp(`\`([^\`]+\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))\``, 'gi'),
        // Match Chinese/unicode paths
        new RegExp(
          `(\\/[^\\s"'\\n]*[\\u4e00-\\u9fff][^\\s"'\\n]*\\.(?:${DETECTABLE_FILE_EXT_WITH_HTML}))`,
          'gi',
        ),
      ];

      const detectedFiles = new Set<string>();

      for (const pattern of filePatterns) {
        const matches = toolOutput.matchAll(pattern);
        for (const match of matches) {
          const rawPath = match[1] || match[0];
          if (!rawPath) continue;
          const filePath = resolveArtifactPath(rawPath, workingDir);
          if (!detectedFiles.has(filePath)) {
            detectedFiles.add(filePath);
            const fileName = getFileName(filePath);
            const fileType = getFileTypeFromPath(filePath);

            await createFile({
              task_id: taskId,
              name: fileName,
              type: fileType,
              path: filePath,
              preview: `Generated by skill: ${toolInput.skill || 'unknown'}`,
            });
            if (import.meta.env.DEV) {
              console.warn(
                '[useAgent] Created file record from Skill output:',
                fileName,
              );
            }
          }
        }
      }
    }
    // Handle MCP media tools — capture generated image/video/audio as artifacts.
    // The backend downloads external URLs to the session workspace folder and
    // appends "Saved to: /path/to/file" to the tool output. Prefer the local
    // path when available; fall back to the external URL for web-only mode.
    if (toolName.startsWith('mcp__') && toolOutput) {
      // Any MCP tool that emits "Saved to: …" — covers speech, image, video,
      // and future generators without name-based heuristics.
      const isMediaTool =
        MCP_LOCAL_PATH_RE.test(toolOutput) ||
        toolName.includes('image') ||
        toolName.includes('media') ||
        toolName.includes('generate');
      if (isMediaTool) {
        const seenPaths = new Set<string>();

        // 1. Prefer local paths saved by backend (pattern: "Saved to: /absolute/path")
        for (const match of toolOutput.matchAll(MCP_LOCAL_PATH_RE_G)) {
          const localPath = match[1];
          if (localPath && !seenPaths.has(localPath)) {
            seenPaths.add(localPath);
            const fileName = localPath.split('/').pop() || 'generated-media';
            const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
            const fileType = ['mp4', 'webm', 'mov'].includes(ext)
              ? 'video'
              : ['mp3', 'wav', 'ogg'].includes(ext)
                ? 'audio'
                : 'image';
            await createFile({
              task_id: taskId,
              name: fileName,
              type: fileType,
              path: localPath,
            });
          }
        }

        // 2. Fall back to external URLs if no local paths found
        if (seenPaths.size === 0) {
          for (const match of toolOutput.matchAll(MCP_MEDIA_URL_RE)) {
            const url = match[0];
            if (url && !seenPaths.has(url)) {
              seenPaths.add(url);
              const urlPath = new URL(url).pathname;
              const fileName =
                urlPath.split('/').pop()?.split('?')[0] ||
                'generated-image.png';
              const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
              const fileType = ['mp4', 'webm', 'mov'].includes(ext)
                ? 'video'
                : ['mp3', 'wav', 'ogg'].includes(ext)
                  ? 'audio'
                  : 'image';
              await createFile({
                task_id: taskId,
                name: fileName,
                type: fileType,
                path: url,
              });
            }
          }
        }
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.error('[useAgent] Failed to extract and save file:', error);
    }
  }
}
