import { useEffect, useState } from 'react';

import {
  ArrowLeftRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FilePlus,
  FolderOpen,
  GitFork,
  Layers,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { AILoadingIndicator } from '@/components/ui/AILoadingIndicator';
import { getClaudeSkillsDir } from '@/shared/lib/paths';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

import { Switch } from '../components/Switch';
import { API_BASE_URL } from '../constants';
import type {
  CatalogResponse,
  CatalogSkill,
  SettingsTabProps,
  SkillInfo,
} from '../types';

// Parse YAML frontmatter from SKILL.md
function parseSkillMdFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const frontmatter = frontmatterMatch[1];
  const result: { name?: string; description?: string } = {};

  // Parse name
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  if (nameMatch) {
    result.name = nameMatch[1].trim();
  }

  // Parse description
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
  if (descMatch) {
    result.description = descMatch[1].trim();
  }

  return result;
}

// Helper function to open folder in system file manager
const openFolderInSystem = async (folderPath: string) => {
  try {
    const response = await fetch(`${API_BASE_URL}/files/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: folderPath, expandHome: true }),
    });
    const data = await response.json();
    if (!data.success) {
      if (import.meta.env.DEV) {
        console.error('[Skills] Failed to open folder:', data.error);
      }
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.error('[Skills] Error opening folder:', err);
    }
  }
};

// Skill card component for installed skills
function SkillCard({
  skill,
  onDelete,
}: {
  skill: SkillInfo;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const [showMenu, setShowMenu] = useState(false);

  return (
    <div className="border-border bg-background hover:border-foreground/20 relative flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="text-foreground text-sm font-medium">
          {skill.name}
        </span>
        {skill.version && (
          <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
            v{skill.version}
          </span>
        )}
      </div>

      {skill.owner && (
        <p className="text-muted-foreground mb-1 text-[11px]">
          by {skill.owner}
        </p>
      )}

      <p className="text-muted-foreground mb-3 line-clamp-2 flex-1 text-xs">
        {skill.description || t.settings.skillsNoDescription}
      </p>

      {skill.updateAvailable && (
        <div className="mb-3 flex items-center gap-1.5">
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            {t.settings.skillsUpdateAvailable}
            {skill.catalogVersion ? ` (v${skill.catalogVersion})` : ''}
          </span>
        </div>
      )}

      <div className="border-border flex items-center justify-end border-t pt-3">
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1 transition-colors"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {showMenu && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowMenu(false)}
              />
              <div className="border-border bg-popover absolute right-0 bottom-full z-20 mb-1 min-w-max rounded-lg border py-1 shadow-lg">
                <button
                  onClick={() => {
                    openFolderInSystem(skill.path);
                    setShowMenu(false);
                  }}
                  className="hover:bg-accent flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors"
                >
                  <FolderOpen className="size-3.5 shrink-0" />
                  {t.settings.skillsOpenFolder}
                </button>
                <button
                  onClick={() => {
                    onDelete();
                    setShowMenu(false);
                  }}
                  className="hover:bg-destructive/10 text-destructive flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap transition-colors"
                >
                  <Trash2 className="size-3.5 shrink-0" />
                  {t.settings.skillsDelete}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Catalog skill card for the marketplace
function CatalogCard({
  skill,
  isInstalled,
  isInstalling,
  onInstall,
}: {
  skill: CatalogSkill;
  isInstalled: boolean;
  isInstalling: boolean;
  onInstall: () => void;
}) {
  const { t } = useLanguage();

  return (
    <div className="border-border bg-background hover:border-foreground/20 flex flex-col rounded-xl border p-4 transition-colors">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">
            {skill.displayName}
          </span>
          {skill.builtIn && (
            <span className="shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              {t.settings.skillsBuiltIn}
            </span>
          )}
        </div>
        <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
          v{skill.version}
        </span>
      </div>

      {!skill.builtIn && (
        <p className="text-muted-foreground mb-1 text-[11px]">
          by {skill.owner}
        </p>
      )}

      <p className="text-muted-foreground mb-4 line-clamp-2 flex-1 text-xs">
        {skill.description || skill.slug}
      </p>

      <div className="border-border border-t pt-3">
        {isInstalled ? (
          <span className="text-muted-foreground text-xs font-medium">
            {t.settings.skillsAlreadyInstalled}
          </span>
        ) : (
          <button
            onClick={onInstall}
            disabled={isInstalling}
            className="bg-foreground text-background hover:bg-foreground/90 flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors disabled:opacity-50"
          >
            {isInstalling ? (
              <>
                <AILoadingIndicator size="sm" />
                {t.settings.skillsInstalling}
              </>
            ) : (
              <>
                <Download className="size-3.5" />
                {t.settings.skillsInstallButton}
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

const CATALOG_PAGE_SIZE = 50;

type MainTab = 'installed' | 'marketplace' | 'settings';

export function SkillsSettings({
  settings,
  onSettingsChange,
}: SettingsTabProps) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mainTab, setMainTab] = useState<MainTab>('installed');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [skillsDirs, setSkillsDirs] = useState<{
    user: string;
    app: string;
  }>({ user: '', app: '' });
  const [defaultSkillsPath, setDefaultSkillsPath] = useState('');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showGitHubImport, setShowGitHubImport] = useState(false);
  const [githubUrl, setGithubUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [deleteDialogSkill, setDeleteDialogSkill] = useState<SkillInfo | null>(
    null,
  );

  // Marketplace state
  const [catalogSkills, setCatalogSkills] = useState<CatalogSkill[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [installingSlug, setInstallingSlug] = useState<string | null>(null);

  // Create Skill state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const { t } = useLanguage();

  // Load default skills path on mount (platform-aware)
  useEffect(() => {
    getClaudeSkillsDir().then(setDefaultSkillsPath);
  }, []);

  const isSkillConfigured = (skill: SkillInfo) => {
    return skill.files.length > 0;
  };

  // Filter and sort installed skills
  const filteredSkills = skills
    .filter((skill) => {
      if (
        searchQuery &&
        !skill.name.toLowerCase().includes(searchQuery.toLowerCase())
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aConfigured = isSkillConfigured(a);
      const bConfigured = isSkillConfigured(b);
      if (a.enabled && aConfigured && !(b.enabled && bConfigured)) return -1;
      if (b.enabled && bConfigured && !(a.enabled && aConfigured)) return 1;
      if (aConfigured && !bConfigured) return -1;
      if (bConfigured && !aConfigured) return 1;
      return 0;
    });

  // Installed skill slugs for quick lookup
  const installedSlugs = new Set(skills.map((s) => s.slug).filter(Boolean));

  const loadSkillsFromPath = async (skillsPath: string) => {
    setLoading(true);
    try {
      // Get all skills directories (app and claude)
      const dirsResponse = await fetch(`${API_BASE_URL}/files/skills-dir`);
      const dirsData = await dirsResponse.json();

      const allSkills: SkillInfo[] = [];

      // Save directory paths
      const dirs: { user: string; app: string } = { user: '', app: '' };
      if (dirsData.directories) {
        for (const dir of dirsData.directories as {
          name: string;
          path: string;
          exists: boolean;
        }[]) {
          if (dir.name === 'claude') {
            dirs.user = dir.path;
          } else if (dir.name === 'app') {
            dirs.app = dir.path;
          }
        }
      }
      setSkillsDirs(dirs);

      // Load skills from user directory only (claude)
      if (dirsData.directories) {
        for (const dir of dirsData.directories as {
          name: string;
          path: string;
          exists: boolean;
        }[]) {
          // Only load from user directory (claude), skip app directory
          if (dir.name !== 'claude' || !dir.exists) continue;

          try {
            const filesResponse = await fetch(`${API_BASE_URL}/files/readdir`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: dir.path, maxDepth: 3 }),
            });
            const filesData = await filesResponse.json();

            if (filesData.success && filesData.files) {
              for (const folder of filesData.files) {
                if (folder.isDir) {
                  // Read SKILL.md for name and description
                  let skillName = folder.name;
                  let description = '';
                  try {
                    const skillMdPath = `${folder.path}/SKILL.md`;
                    const mdResponse = await fetch(
                      `${API_BASE_URL}/files/read`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: skillMdPath }),
                      },
                    );
                    const mdData = await mdResponse.json();
                    if (mdData.success && mdData.content) {
                      const frontmatter = parseSkillMdFrontmatter(
                        mdData.content,
                      );
                      if (frontmatter.name) {
                        skillName = frontmatter.name;
                      }
                      if (frontmatter.description) {
                        description = frontmatter.description;
                      }
                    }
                  } catch {
                    // Ignore errors reading SKILL.md
                  }

                  // Read _meta.json for version/owner info
                  let owner: string | undefined;
                  let version: string | undefined;
                  let publishedAt: number | undefined;
                  let slug: string | undefined;
                  try {
                    const metaPath = `${folder.path}/_meta.json`;
                    const metaResponse = await fetch(
                      `${API_BASE_URL}/files/read`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: metaPath }),
                      },
                    );
                    const metaData = await metaResponse.json();
                    if (metaData.success && metaData.content) {
                      const meta = JSON.parse(metaData.content);
                      owner = meta.owner;
                      slug = meta.slug;
                      version = meta.latest?.version;
                      publishedAt = meta.latest?.publishedAt;
                      if (meta.displayName && !description) {
                        skillName = meta.displayName;
                      }
                    }
                  } catch {
                    // No _meta.json, that's fine
                  }

                  allSkills.push({
                    id: `${dir.name}-${folder.name}`,
                    name: skillName,
                    source: dir.name as 'claude' | 'app',
                    path: folder.path,
                    files: folder.children || [],
                    enabled: true,
                    description,
                    owner,
                    version,
                    publishedAt,
                    slug: slug || folder.name,
                  });
                }
              }
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.error(
                `[Skills] Failed to load skills from ${dir.name}:`,
                err,
              );
            }
          }
        }
      }

      // Also load from user-configured skillsPath if different from default directories
      if (skillsPath) {
        const isDefaultDir = dirsData.directories?.some(
          (d: { path: string }) => d.path === skillsPath,
        );
        if (!isDefaultDir) {
          try {
            const filesResponse = await fetch(`${API_BASE_URL}/files/readdir`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: skillsPath, maxDepth: 3 }),
            });
            const filesData = await filesResponse.json();

            if (filesData.success && filesData.files) {
              for (const folder of filesData.files) {
                if (folder.isDir) {
                  let skillName = folder.name;
                  let description = '';
                  try {
                    const skillMdPath = `${folder.path}/SKILL.md`;
                    const mdResponse = await fetch(
                      `${API_BASE_URL}/files/read`,
                      {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ path: skillMdPath }),
                      },
                    );
                    const mdData = await mdResponse.json();
                    if (mdData.success && mdData.content) {
                      const frontmatter = parseSkillMdFrontmatter(
                        mdData.content,
                      );
                      if (frontmatter.name) {
                        skillName = frontmatter.name;
                      }
                      if (frontmatter.description) {
                        description = frontmatter.description;
                      }
                    }
                  } catch {
                    // Ignore errors reading SKILL.md
                  }

                  allSkills.push({
                    id: `custom-${folder.name}`,
                    name: skillName,
                    source: 'app',
                    path: folder.path,
                    files: folder.children || [],
                    enabled: true,
                    description,
                    slug: folder.name,
                  });
                }
              }
            }
          } catch (err) {
            if (import.meta.env.DEV) {
              console.error(
                '[Skills] Failed to load skills from custom path:',
                err,
              );
            }
          }
        }
      }

      setSkills(allSkills);
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Skills] Failed to load skills:', err);
      }
      setSkills([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkillsFromPath(settings.skillsPath);
  }, [settings.skillsPath]);

  // Check for updates: compare installed versions with catalog
  const skillsCount = skills.length;
  useEffect(() => {
    if (skillsCount === 0 || catalogSkills.length === 0) return;

    const catalogMap = new Map(catalogSkills.map((c) => [c.slug, c.version]));

    setSkills((prev) =>
      prev.map((skill) => {
        if (!skill.slug || !skill.version) return skill;
        const catVersion = catalogMap.get(skill.slug);
        if (catVersion && catVersion !== skill.version) {
          return {
            ...skill,
            updateAvailable: true,
            catalogVersion: catVersion,
          };
        }
        return skill;
      }),
    );
  }, [catalogSkills, skillsCount]);

  // Load catalog when switching to marketplace tab
  const loadCatalog = async (page: number, search: string) => {
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(CATALOG_PAGE_SIZE),
      });
      if (search) params.set('search', search);

      const response = await fetch(
        `${API_BASE_URL}/files/skills-catalog?${params}`,
      );
      const data = (await response.json()) as CatalogResponse;
      if (data.success) {
        setCatalogSkills(data.items);
        setCatalogTotal(data.total);
        setCatalogPage(data.page);
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Skills] Failed to load catalog:', err);
      }
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (mainTab === 'marketplace') {
      loadCatalog(1, '');
    }
  }, [mainTab]);

  const handleCatalogSearch = () => {
    setCatalogPage(1);
    loadCatalog(1, catalogSearch);
  };

  const handleCatalogPageChange = (newPage: number) => {
    setCatalogPage(newPage);
    loadCatalog(newPage, catalogSearch);
  };

  const handleInstallSkill = async (skill: CatalogSkill) => {
    setInstallingSlug(skill.slug);
    try {
      const response = await fetch(`${API_BASE_URL}/files/install-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: skill.owner, slug: skill.slug }),
      });
      const data = await response.json();
      if (data.success) {
        // Refresh installed skills
        loadSkillsFromPath(settings.skillsPath);
      } else {
        if (import.meta.env.DEV) {
          console.error('[Skills] Install failed:', data.error);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Skills] Install error:', err);
      }
    } finally {
      setInstallingSlug(null);
    }
  };

  const handleCreateSkill = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/files/create-skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          description: createDescription.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (data.success) {
        setShowCreateDialog(false);
        setCreateName('');
        setCreateDescription('');
        loadSkillsFromPath(settings.skillsPath);
      } else {
        if (import.meta.env.DEV) {
          console.error('[Skills] Create failed:', data.error);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[Skills] Create error:', err);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteSkill = (skillId: string) => {
    const skill = skills.find((s) => s.id === skillId);
    if (skill) {
      setDeleteDialogSkill(skill);
    }
  };

  const handleOpenSkillFolder = () => {
    if (deleteDialogSkill) {
      openFolderInSystem(deleteDialogSkill.path);
      setDeleteDialogSkill(null);
    }
  };

  const totalCatalogPages = Math.ceil(catalogTotal / CATALOG_PAGE_SIZE);

  if (loading) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center gap-2">
        <AILoadingIndicator size="sm" />
        {t.common.loading}
      </div>
    );
  }

  return (
    <div className="-m-6 flex h-[calc(100%+48px)] flex-col">
      {/* Tab Bar */}
      <div className="border-border shrink-0 border-b px-6">
        <div className="flex items-center gap-6">
          <button
            onClick={() => setMainTab('installed')}
            className={cn(
              'relative py-4 text-sm font-medium transition-colors',
              mainTab === 'installed'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.settings.skillsInstalled}
            {mainTab === 'installed' && (
              <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
            )}
          </button>
          <button
            onClick={() => setMainTab('marketplace')}
            className={cn(
              'relative py-4 text-sm font-medium transition-colors',
              mainTab === 'marketplace'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.settings.skillsMarketplace}
            {mainTab === 'marketplace' && (
              <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
            )}
          </button>
          <button
            onClick={() => setMainTab('settings')}
            className={cn(
              'relative py-4 text-sm font-medium transition-colors',
              mainTab === 'settings'
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.settings.title}
            {mainTab === 'settings' && (
              <span className="bg-foreground absolute bottom-0 left-0 h-0.5 w-full" />
            )}
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mainTab === 'installed' ? (
          /* Installed Tab Content */
          <div className="flex h-full flex-col">
            {/* Filter Bar */}
            <div className="bg-background sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                {/* Search Input */}
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.settings.skillsSearch}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-64 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Add Button with Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowAddMenu(!showAddMenu)}
                    className="bg-foreground text-background hover:bg-foreground/90 flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors"
                  >
                    <Plus className="size-4" />
                    {t.settings.add}
                    <ChevronDown className="size-4" />
                  </button>
                  {showAddMenu && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setShowAddMenu(false)}
                      />
                      <div className="border-border bg-popover absolute top-full right-0 z-50 mt-1 min-w-[180px] rounded-xl border py-1 shadow-lg">
                        <button
                          onClick={() => {
                            setShowCreateDialog(true);
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <FilePlus className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.skillsCreateNew}
                          </span>
                        </button>
                        <button
                          onClick={() => {
                            openFolderInSystem(skillsDirs.user);
                            setShowAddMenu(false);
                          }}
                          className="hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                        >
                          <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                          <span className="text-foreground text-sm">
                            {t.settings.skillsAddToDirectory}
                          </span>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Skills Grid */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {filteredSkills.length === 0 ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                  {searchQuery
                    ? t.settings.skillsNoResults
                    : t.settings.skillsEmpty}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {filteredSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      onDelete={() => handleDeleteSkill(skill.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : mainTab === 'marketplace' ? (
          /* Marketplace Tab Content */
          <div className="flex h-full flex-col">
            {/* Search Bar */}
            <div className="bg-background sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 px-6 pt-6 pb-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                  <input
                    type="text"
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCatalogSearch();
                    }}
                    placeholder={t.settings.skillsSearchCatalog}
                    className="border-input bg-background text-foreground placeholder:text-muted-foreground focus:ring-ring h-9 w-72 rounded-lg border py-2 pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                  />
                </div>
              </div>
              <span className="text-muted-foreground text-xs">
                {t.settings.skillsAvailable.replace(
                  '{count}',
                  String(catalogTotal),
                )}
              </span>
            </div>

            {/* Catalog Grid */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {catalogLoading ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center gap-2">
                  <AILoadingIndicator size="sm" />
                  {t.common.loading}
                </div>
              ) : catalogSkills.length === 0 ? (
                <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
                  {t.settings.skillsCatalogEmpty}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  {catalogSkills.map((skill) => (
                    <CatalogCard
                      key={`${skill.owner}/${skill.slug}`}
                      skill={skill}
                      isInstalled={installedSlugs.has(skill.slug)}
                      isInstalling={installingSlug === skill.slug}
                      onInstall={() => handleInstallSkill(skill)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Pagination */}
            {totalCatalogPages > 1 && (
              <div className="border-border flex shrink-0 items-center justify-center gap-2 border-t px-6 py-3">
                <button
                  onClick={() => handleCatalogPageChange(catalogPage - 1)}
                  disabled={catalogPage <= 1}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1 transition-colors disabled:opacity-30"
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-muted-foreground text-xs">
                  {catalogPage} / {totalCatalogPages}
                </span>
                <button
                  onClick={() => handleCatalogPageChange(catalogPage + 1)}
                  disabled={catalogPage >= totalCatalogPages}
                  className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-1 transition-colors disabled:opacity-30"
                >
                  <ChevronRight className="size-4" />
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Settings Tab Content */
          <div className="space-y-4 p-6">
            {/* Global Enable Switch */}
            <div className="border-border bg-background rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-foreground text-sm font-medium">
                    {t.settings.skillsEnabled}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t.settings.skillsEnabledDescription}
                  </p>
                </div>
                <Switch
                  checked={settings.skillsEnabled !== false}
                  onChange={(checked) =>
                    onSettingsChange({ ...settings, skillsEnabled: checked })
                  }
                />
              </div>
            </div>

            {/* Skills Directory */}
            <div
              className={cn(
                'border-border bg-background rounded-xl border p-4 transition-opacity',
                settings.skillsEnabled === false && 'opacity-50',
              )}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <h3 className="text-foreground text-sm font-medium">
                    {t.settings.skillsSource}
                  </h3>
                  <code className="bg-muted text-muted-foreground mt-2 block truncate rounded px-2 py-1 text-xs">
                    {skillsDirs.user || defaultSkillsPath}
                  </code>
                </div>
                <div className="ml-4 flex shrink-0 items-center gap-2">
                  <button
                    onClick={() => openFolderInSystem(skillsDirs.user)}
                    className="text-muted-foreground hover:text-foreground hover:bg-accent rounded p-2 transition-colors"
                    title={t.settings.skillsOpenFolder}
                  >
                    <FolderOpen className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete Skill Dialog */}
      {deleteDialogSkill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setDeleteDialogSkill(null)}
          />
          <div className="bg-background border-border relative z-10 w-[400px] rounded-xl border p-6 shadow-lg">
            <h3 className="text-foreground mb-2 text-base font-semibold">
              {t.settings.skillsDeleteTitle}
            </h3>
            <p className="text-muted-foreground mb-4 text-sm">
              {t.settings.skillsDeleteDescription}
            </p>
            <div className="bg-muted mb-4 rounded-lg p-3">
              <code className="text-foreground text-xs break-all">
                {deleteDialogSkill.path}
              </code>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteDialogSkill(null)}
                className="border-border hover:bg-accent h-9 rounded-lg border px-4 text-sm transition-colors"
              >
                {t.common.cancel}
              </button>
              <button
                onClick={handleOpenSkillFolder}
                className="bg-primary text-primary-foreground hover:bg-primary/90 flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors"
              >
                <FolderOpen className="size-4" />
                {t.settings.skillsOpenFolder}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Skill Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => {
              setShowCreateDialog(false);
              setCreateName('');
              setCreateDescription('');
            }}
          />
          <div className="bg-background border-border relative z-10 w-[420px] rounded-xl border p-6 shadow-lg">
            <button
              onClick={() => {
                setShowCreateDialog(false);
                setCreateName('');
                setCreateDescription('');
              }}
              className="text-muted-foreground hover:text-foreground absolute top-4 right-4"
            >
              <X className="size-5" />
            </button>

            <h3 className="text-foreground mb-2 text-lg font-semibold">
              {t.settings.skillsCreateTitle}
            </h3>
            <p className="text-muted-foreground mb-6 text-sm">
              {t.settings.skillsCreateDescription}
            </p>

            <div className="mb-4">
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t.settings.skillsNameLabel}
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder={t.settings.skillsNamePlaceholder}
                className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring h-11 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSkill();
                }}
              />
            </div>

            <div className="mb-6">
              <label className="text-foreground mb-2 block text-sm font-medium">
                {t.settings.skillsDescriptionLabel}
              </label>
              <textarea
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder={t.settings.skillsDescriptionPlaceholder}
                rows={3}
                className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring w-full resize-none rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              />
            </div>

            <button
              onClick={handleCreateSkill}
              disabled={!createName.trim() || creating}
              className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? (
                <>
                  <AILoadingIndicator size="sm" />
                  {t.settings.skillsCreating}
                </>
              ) : (
                t.settings.skillsCreate
              )}
            </button>
          </div>
        </div>
      )}

      {/* Import from GitHub Dialog */}
      {showGitHubImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => {
              setShowGitHubImport(false);
              setGithubUrl('');
            }}
          />
          <div className="bg-background border-border relative z-10 w-[420px] rounded-xl border p-6 shadow-lg">
            <button
              onClick={() => {
                setShowGitHubImport(false);
                setGithubUrl('');
              }}
              className="text-muted-foreground hover:text-foreground absolute top-4 right-4"
            >
              <X className="size-5" />
            </button>

            {/* Icons */}
            <div className="mb-4 flex items-center justify-center gap-3">
              <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                <GitFork className="size-6" />
              </div>
              <ArrowLeftRight className="text-muted-foreground size-5" />
              <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
                <Layers className="size-6" />
              </div>
            </div>

            <h3 className="text-foreground mb-2 text-center text-lg font-semibold">
              {t.settings.skillsImportGitHub}
            </h3>
            <p className="text-muted-foreground mb-6 text-center text-sm">
              {t.settings.skillsImportGitHubDialogDesc}
            </p>

            <div className="mb-4">
              <label className="text-foreground mb-2 block text-sm font-medium">
                URL
              </label>
              <input
                type="text"
                value={githubUrl}
                onChange={(e) => setGithubUrl(e.target.value)}
                placeholder="https://github.com/username/repo"
                className="border-input bg-muted text-foreground placeholder:text-muted-foreground focus:ring-ring h-11 w-full rounded-lg border px-3 text-sm focus:ring-2 focus:outline-none"
              />
            </div>

            <button
              onClick={async () => {
                if (!githubUrl) return;
                setImporting(true);
                try {
                  const response = await fetch(
                    `${API_BASE_URL}/files/import-skill`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        url: githubUrl,
                        targetDir: skillsDirs.user,
                      }),
                    },
                  );
                  const data = await response.json();
                  if (data.success) {
                    setShowGitHubImport(false);
                    setGithubUrl('');
                    // Reload skills
                    loadSkillsFromPath(settings.skillsPath || '');
                  } else {
                    if (import.meta.env.DEV) {
                      console.error('[Skills] Import failed:', data.error);
                    }
                  }
                } catch (err) {
                  if (import.meta.env.DEV) {
                    console.error('[Skills] Import error:', err);
                  }
                } finally {
                  setImporting(false);
                }
              }}
              disabled={!githubUrl || importing}
              className="bg-foreground text-background hover:bg-foreground/90 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? (
                <>
                  <AILoadingIndicator size="sm" />
                  {t.settings.skillsImporting}
                </>
              ) : (
                t.settings.skillsImport
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
