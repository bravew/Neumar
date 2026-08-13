import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

import {
  deleteDesignFiles,
  listDesignFiles,
  renameDesignFile,
  updateDesignProject,
} from '@/shared/hooks/useDesignMode';
import { useLanguage } from '@/shared/providers/language-provider';
import type {
  DesignFileEntry,
  DesignOutput,
  DesignProject,
} from '@/shared/types/design-mode';

import {
  classifyFileSystemReadError,
  type FileSystemReadError,
} from './file-system-errors';
import {
  directoryDisplayName,
  directoryEntries,
  filterDesignFilesByKind,
  flattenFiles,
  groupDesignFiles,
  parentDirectoryPath,
  type FileWorkspaceGroupKey,
  type FileWorkspaceKindFilter,
  type FileWorkspaceSortDirection,
  type FileWorkspaceSortKey,
  isEditableTarget,
  isScaffoldPath,
  pickInitialFile,
  sortDesignFiles,
} from './file-workspace-utils';

const DEFAULT_SORT_BY: FileWorkspaceSortKey = 'name';
const DEFAULT_SORT_DIRECTION: FileWorkspaceSortDirection = 'asc';
const DEFAULT_GROUP_BY: FileWorkspaceGroupKey = 'none';
const DEFAULT_KIND_FILTER: FileWorkspaceKindFilter = 'all';

function persistedCurrentDirectory(project?: DesignProject): string | null {
  const value = project?.ui?.fileWorkspace?.currentDirectory;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function useFileWorkspaceController({
  projectId,
  project,
  outputs,
  onProjectChange,
  reloadSignal = 0,
}: {
  projectId: string;
  project?: DesignProject;
  outputs: DesignOutput[];
  onProjectChange?: (project: DesignProject) => void;
  /**
   * Bumped by the parent to force a file-list refetch — e.g. when a design-chat
   * agent run finishes writing artifacts the watcher hasn't surfaced yet.
   */
  reloadSignal?: number;
}) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [files, setFiles] = useState<DesignFileEntry[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [fileListError, setFileListError] =
    useState<FileSystemReadError | null>(null);
  const [fileListReloadKey, setFileListReloadKey] = useState(0);
  const [currentDirectory, setCurrentDirectory] = useState<string | null>(() =>
    persistedCurrentDirectory(project),
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [fileTabs, setFileTabs] = useState<string[]>(
    () => project?.ui?.fileTabs?.order ?? [],
  );
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dirtySketch, setDirtySketch] = useState(false);
  const [sortBy, setSortBy] = useState<FileWorkspaceSortKey>(
    () => project?.ui?.fileWorkspace?.sortBy ?? DEFAULT_SORT_BY,
  );
  const [sortDirection, setSortDirection] =
    useState<FileWorkspaceSortDirection>(
      () => project?.ui?.fileWorkspace?.sortDirection ?? DEFAULT_SORT_DIRECTION,
    );
  const [groupBy, setGroupBy] = useState<FileWorkspaceGroupKey>(
    () => project?.ui?.fileWorkspace?.groupBy ?? DEFAULT_GROUP_BY,
  );
  const [kindFilter, setKindFilter] = useState<FileWorkspaceKindFilter>(
    () => project?.ui?.fileWorkspace?.kindFilter ?? DEFAULT_KIND_FILTER,
  );

  useEffect(() => {
    const ac = new AbortController();
    setFiles([]);
    setFilesLoaded(false);
    setActivePath(null);
    setFileListError(null);
    listDesignFiles(projectId, { signal: ac.signal })
      .then((result) => {
        setFiles(result.files);
        setFileListError(null);
        setFilesLoaded(true);
      })
      .catch((error: unknown) => {
        if (!ac.signal.aborted) {
          setFiles([]);
          setFileListError(classifyFileSystemReadError(error));
          setFilesLoaded(true);
        }
      });
    return () => ac.abort();
  }, [fileListReloadKey, projectId, outputs.length, reloadSignal]);

  useEffect(() => {
    setFileTabs(project?.ui?.fileTabs?.order ?? []);
  }, [projectId, project?.ui?.fileTabs?.order]);

  useEffect(() => {
    setCurrentDirectory(persistedCurrentDirectory(project));
    setSelectedPaths(new Set());
    setLastSelectedPath(null);
  }, [projectId, project?.ui?.fileWorkspace?.currentDirectory]);

  useEffect(() => {
    setSortBy(project?.ui?.fileWorkspace?.sortBy ?? DEFAULT_SORT_BY);
    setSortDirection(
      project?.ui?.fileWorkspace?.sortDirection ?? DEFAULT_SORT_DIRECTION,
    );
    setGroupBy(project?.ui?.fileWorkspace?.groupBy ?? DEFAULT_GROUP_BY);
    setKindFilter(
      project?.ui?.fileWorkspace?.kindFilter ?? DEFAULT_KIND_FILTER,
    );
  }, [projectId, project?.ui?.fileWorkspace]);

  const flatFiles = useMemo(() => flattenFiles(files), [files]);
  const selectableFiles = useMemo(
    () => flatFiles.filter((file) => !file.isDir),
    [flatFiles],
  );
  const visibleEntries = useMemo(
    () => directoryEntries(files, currentDirectory),
    [currentDirectory, files],
  );
  const visibleDirectories = useMemo(
    () =>
      visibleEntries
        .filter((file) => file.isDir)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [visibleEntries],
  );
  const visibleSelectableFiles = useMemo(
    () => visibleEntries.filter((file) => !file.isDir),
    [visibleEntries],
  );
  const filteredFiles = useMemo(
    () => filterDesignFilesByKind(visibleSelectableFiles, kindFilter),
    [kindFilter, visibleSelectableFiles],
  );
  const sortedVisibleFiles = useMemo(
    () => sortDesignFiles(filteredFiles, sortBy, sortDirection),
    [filteredFiles, sortBy, sortDirection],
  );
  const sortedFiles = useMemo(
    () =>
      sortDesignFiles(
        filterDesignFilesByKind(selectableFiles, kindFilter),
        sortBy,
        sortDirection,
      ),
    [kindFilter, selectableFiles, sortBy, sortDirection],
  );
  const groupedFiles = useMemo(
    () => groupDesignFiles(sortedVisibleFiles, groupBy),
    [groupBy, sortedVisibleFiles],
  );
  const selectedFilePaths = useMemo(
    () =>
      [...selectedPaths].filter((path) =>
        selectableFiles.some((file) => file.path === path),
      ),
    [selectableFiles, selectedPaths],
  );
  const existingFilePaths = useMemo(
    () => new Set(selectableFiles.map((file) => file.path)),
    [selectableFiles],
  );
  const visibleFileTabs = useMemo(
    () => fileTabs.filter((path) => existingFilePaths.has(path)),
    [existingFilePaths, fileTabs],
  );
  const routeFilePath = useMemo(() => {
    const value = new URLSearchParams(location.search).get('file');
    return value || null;
  }, [location.search]);
  const currentDirectoryLabel = directoryDisplayName(currentDirectory);

  const persistFileTabs = useCallback(
    async (nextOrder: string[]) => {
      const result = await updateDesignProject(projectId, {
        ui: {
          ...(project?.ui ?? {}),
          fileTabs: {
            ...(project?.ui?.fileTabs ?? {}),
            order: nextOrder,
          },
        },
      });
      onProjectChange?.(result.project);
    },
    [onProjectChange, project?.ui, projectId],
  );

  const persistFileWorkspace = useCallback(
    async (
      next: Partial<{
        sortBy: FileWorkspaceSortKey;
        sortDirection: FileWorkspaceSortDirection;
        groupBy: FileWorkspaceGroupKey;
        kindFilter: FileWorkspaceKindFilter;
        currentDirectory: string | null;
      }>,
    ) => {
      const fileWorkspace = {
        sortBy,
        sortDirection,
        groupBy,
        kindFilter,
        ...(currentDirectory ? { currentDirectory } : {}),
        ...next,
      };
      const result = await updateDesignProject(projectId, {
        ui: {
          ...(project?.ui ?? {}),
          fileWorkspace: {
            ...(project?.ui?.fileWorkspace ?? {}),
            ...fileWorkspace,
          },
        },
      });
      onProjectChange?.(result.project);
    },
    [
      groupBy,
      kindFilter,
      onProjectChange,
      project?.ui,
      projectId,
      sortBy,
      sortDirection,
      currentDirectory,
    ],
  );

  const confirmDirtySketch = useCallback(() => {
    if (!dirtySketch) return true;
    return Boolean(globalThis.confirm?.(t.design.closeDirtySketchConfirm));
  }, [dirtySketch, t.design.closeDirtySketchConfirm]);

  const setActiveFileState = useCallback((path: string | null) => {
    setActivePath(path);
    if (!path) return;
    setFileTabs((current) =>
      current.includes(path) ? current : [...current, path],
    );
  }, []);

  const syncFileRoute = useCallback(
    (path: string | null, replace = false) => {
      const params = new URLSearchParams(location.search);
      const current = params.get('file') || null;
      if (current === path) return;
      if (path) params.set('file', path);
      else params.delete('file');
      const search = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: search ? `?${search}` : '',
          hash: location.hash,
        },
        { replace },
      );
    },
    [location.hash, location.pathname, location.search, navigate],
  );

  const openFile = useCallback(
    (path: string | null, options?: { replace?: boolean }) => {
      if (path !== activePath && !confirmDirtySketch()) return;
      setDeleteError(null);
      setDirtySketch(false);
      setActiveFileState(path);
      syncFileRoute(path, options?.replace);
    },
    [activePath, confirmDirtySketch, setActiveFileState, syncFileRoute],
  );

  const openDirectory = useCallback(
    (path: string | null, options?: { persist?: boolean }) => {
      setCurrentDirectory(path);
      setSelectedPaths(new Set());
      setLastSelectedPath(null);
      setDeleteError(null);
      if (!project || options?.persist === false) return;
      void persistFileWorkspace({ currentDirectory: path }).catch(
        (error: unknown) => {
          setDeleteError(
            error instanceof Error ? error.message : String(error),
          );
        },
      );
    },
    [persistFileWorkspace, project],
  );

  const goUpDirectory = useCallback(() => {
    openDirectory(parentDirectoryPath(currentDirectory));
  }, [currentDirectory, openDirectory]);

  const retryFileList = useCallback(() => {
    setFileListReloadKey((key) => key + 1);
  }, []);

  const reorderFileTabs = useCallback(
    (nextOrder: string[]) => {
      setFileTabs(nextOrder);
      void persistFileTabs(nextOrder).catch((error: unknown) => {
        setDeleteError(error instanceof Error ? error.message : String(error));
      });
    },
    [persistFileTabs],
  );

  useEffect(() => {
    const paths = new Set(selectableFiles.map((file) => file.path));
    setSelectedPaths(
      (current) => new Set([...current].filter((path) => paths.has(path))),
    );
  }, [selectableFiles]);

  useEffect(() => {
    if (!filesLoaded) return;
    if (!currentDirectory) return;
    if (flatFiles.some((file) => file.isDir && file.path === currentDirectory))
      return;
    openDirectory(parentDirectoryPath(currentDirectory));
  }, [currentDirectory, filesLoaded, flatFiles, openDirectory]);

  useEffect(() => {
    if (!filesLoaded) return;
    const paths = new Set(selectableFiles.map((file) => file.path));
    if (routeFilePath && paths.has(routeFilePath)) {
      if (activePath !== routeFilePath) setActiveFileState(routeFilePath);
      return;
    }
    const primaryOutputPath = outputs.find((output) =>
      paths.has(output.path),
    )?.path;
    if (
      primaryOutputPath &&
      activePath !== primaryOutputPath &&
      (!activePath || isScaffoldPath(activePath))
    ) {
      openFile(primaryOutputPath, { replace: true });
      return;
    }
    if (activePath && paths.has(activePath)) return;
    openFile(pickInitialFile(selectableFiles, primaryOutputPath), {
      replace: true,
    });
  }, [
    activePath,
    filesLoaded,
    openFile,
    outputs,
    routeFilePath,
    selectableFiles,
    setActiveFileState,
  ]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'p'
      ) {
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      setQuickSwitcherOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleSelection = (path: string, range: boolean) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      const filePaths = sortedVisibleFiles.map((file) => file.path);
      if (range && lastSelectedPath && filePaths.includes(lastSelectedPath)) {
        const start = filePaths.indexOf(lastSelectedPath);
        const end = filePaths.indexOf(path);
        for (const selected of filePaths.slice(
          Math.min(start, end),
          Math.max(start, end) + 1,
        )) {
          next.add(selected);
        }
      } else if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
    setLastSelectedPath(path);
  };

  const refreshFiles = async () => {
    const result = await listDesignFiles(projectId);
    setFiles(result.files);
    setFileListError(null);
  };

  const updateSortBy = (value: FileWorkspaceSortKey) => {
    setSortBy(value);
    void persistFileWorkspace({ sortBy: value }).catch((error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : String(error));
    });
  };

  const updateSortDirection = (value: FileWorkspaceSortDirection) => {
    setSortDirection(value);
    void persistFileWorkspace({ sortDirection: value }).catch(
      (error: unknown) => {
        setDeleteError(error instanceof Error ? error.message : String(error));
      },
    );
  };

  const updateGroupBy = (value: FileWorkspaceGroupKey) => {
    setGroupBy(value);
    void persistFileWorkspace({ groupBy: value }).catch((error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : String(error));
    });
  };

  const updateKindFilter = (value: FileWorkspaceKindFilter) => {
    setKindFilter(value);
    void persistFileWorkspace({ kindFilter: value }).catch((error: unknown) => {
      setDeleteError(error instanceof Error ? error.message : String(error));
    });
  };

  const renameFile = async (from: string, to: string) => {
    setDeleteError(null);
    try {
      const result = await renameDesignFile(projectId, from, to);
      await refreshFiles();
      setSelectedPaths((current) => {
        const next = new Set(current);
        if (next.delete(from)) next.add(result.file.path);
        return next;
      });
      setFileTabs((current) =>
        current.map((path) => (path === from ? result.file.path : path)),
      );
      setActivePath((current) =>
        current === from ? result.file.path : current,
      );
      if (activePath === from) syncFileRoute(result.file.path, true);
      setLastSelectedPath((current) =>
        current === from ? result.file.path : current,
      );
      onProjectChange?.(result.project);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  const deleteSelectedFiles = async () => {
    if (selectedFilePaths.length === 0) return;
    const confirmed = globalThis.confirm?.(
      t.design.deleteFilesConfirm
        .replace('{count}', String(selectedFilePaths.length))
        .replace('{files}', selectedFilePaths.join('\n')),
    );
    if (!confirmed) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteDesignFiles(projectId, selectedFilePaths);
      await refreshFiles();
      if (activePath && selectedFilePaths.includes(activePath)) {
        openFile(null, { replace: true });
      }
      setFileTabs((current) =>
        current.filter((path) => !selectedFilePaths.includes(path)),
      );
      setSelectedPaths(new Set());
      setLastSelectedPath(null);
      onProjectChange?.(result.project);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return {
    activePath,
    deleting,
    deleteError,
    currentDirectory,
    currentDirectoryLabel,
    fileListError,
    files,
    fileTabs: visibleFileTabs,
    groupBy,
    groupedFiles,
    kindFilter,
    quickSwitcherOpen,
    selectedFilePaths,
    selectedPaths,
    sortedFiles,
    sortBy,
    sortDirection,
    visibleDirectories,
    deleteSelectedFiles,
    goUpDirectory,
    openFile,
    openDirectory,
    renameFile,
    reorderFileTabs,
    retryFileList,
    setDirtySketch,
    setQuickSwitcherOpen,
    setSelectedPaths,
    toggleSelection,
    updateGroupBy,
    updateKindFilter,
    updateSortBy,
    updateSortDirection,
  };
}
