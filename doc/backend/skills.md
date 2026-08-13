---
summary: "Skills system — plugin-backed skill loading, legacy SKILL.md compatibility, marketplace browsing, create wizard, and profile restrictions"
read_when:
  - Creating or modifying skills
  - Working on the skills marketplace UI
  - Understanding how skills integrate with agents
title: "Skills System"
---

# Skills System

Skills extend agent capabilities with custom instructions and optional side
files. The current runtime loads skills through the plugin loader, while the
older Settings > Skills screen still manages flat `SKILL.md` directories for
Claude-compatible workflows.

## Skill Sources

- Plugin skills from `@/shared/plugins`:
  - repo/builtin plugin roots
  - project plugins passed as `projectDir` (installed project plugins use `<workDir>/.plugins`)
  - user plugins in `~/.<slug>/plugins/`
  - marketplace cache/staging in `~/.<slug>/marketplace/`
  - bundled sidecar skills
- Legacy flat skills in `~/.claude/skills/<slug>/SKILL.md`; the plugin loader
  synthesizes these as `legacy` plugins when they do not already contain a
  plugin manifest.
- The Settings > Skills catalog still reads bundled flat skills plus the
  optional community catalog from `SKILLS_CATALOG_DIR`.

## Skill Format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter.
Inside a plugin, skills normally live under the manifest's `skills` directory:

```markdown
---
name: my-skill
description: What this skill does
version: 1.0.0
author: Author Name
---

# Skill instructions (markdown)
```

Plugin-loaded skill names are namespaced as `pluginName:skillName`; `bareName`
preserves the unprefixed skill name for legacy callers. The loader also reads
Open Design compatibility skill paths from `metadata.neuma.skillFiles`.

**`_meta.json` format** is used only by the flat skills catalog UI:

```json
{
  "owner": "github-username",
  "slug": "skill-slug",
  "displayName": "Human-Readable Name",
  "latest": {
    "version": "1.0.1",
    "publishedAt": 1771075691101,
    "commit": "https://github.com/..."
  },
  "history": []
}
```

## Runtime Loading

`src-api/src/shared/skills/loader.ts` is now a compatibility shim over
`@/shared/plugins`. It preserves the v1 API surface:

| Function | Behavior |
| -------- | -------- |
| `loadSkills({ enabled })` | Calls `loadAllSkills()` from the plugin loader and returns namespaced plugin skills plus legacy flat skills |
| `findSkill(skills, nameOrSlug)` | Matches namespaced name, bare name, or directory basename |
| `getSkillsPath()` | Returns the Claude-compatible flat skills directory |
| `loadSkillFromDir(dir)` | Parses one flat `SKILL.md` directory with no plugin namespace |

Disabled plugin rows are skipped by the plugin loader, including disabled
built-ins. Built-in plugins are reconciled into `installed_plugins` on startup
so their enabled state survives restarts.

## Flat Skills Catalog

**Browsing** (`GET /files/skills-catalog`):
- Scans `_meta.json` files under the optional community catalog directory
- Falls back to bundled flat skills when no external catalog ships
- Builds an in-memory index sorted by `publishedAt` desc
- Index is cached for 5 minutes (`CATALOG_CACHE_TTL_MS`)
- Supports paginated browsing with search (matches `displayName`, `slug`, `owner`)
- Catalog directory is resolved via `SKILLS_CATALOG_DIR` env var, or auto-detected relative to `process.cwd()`

**One-click install** (`POST /files/install-skill`):
- Copies a catalog skill directory into `~/.claude/skills/<slug>/` via `fs.cp(src, dst, { recursive: true })`
- Returns 409 if already installed, 404 if not in catalog

**Create Skill wizard** (`POST /files/create-skill`):
- Sanitizes the user-provided name to a kebab-case slug
- Creates `~/.claude/skills/<slug>/SKILL.md` with template frontmatter and body
- Returns 409 if the slug already exists

**Update detection:** The frontend compares installed skill versions (from `_meta.json`) against
catalog versions and flags skills with `updateAvailable` when a newer version exists.

## Plugin Marketplace Skills

Settings > Plugins and Library > Marketplace install Anthropic-style plugins
from local paths, GitHub refs, URLs, or persisted marketplace sources. A plugin
can include skills, commands, hooks, MCP servers, config fields, and surface
metadata. The plugin install pipeline validates the manifest, copies and hashes
the tree, verifies manifest signatures, records provenance, and stores the
plugin in `installed_plugins`.

Marketplace entries can be inspected before install when the source is
GitHub-backed. The detail dialog fetches skill frontmatter, eval metadata,
README content, and Open Design workflow metadata directly from raw GitHub
files without installing the plugin.

Plugin configuration fields come from `metadata.neuma.configSchema`. Installed
plugin config is served by `GET /plugins/:id/config` and saved by
`PUT /plugins/:id/config`; secret values are kept in the app secret store and
only referenced from `plugin_config_values`.

## Frontend UI

`SkillsSettings.tsx` provides the legacy flat-skill management UI:
- Three tabs: **Installed** (manage installed skills with version badges and update indicators),
  **Marketplace** (browse/search/install from catalog), **Settings** (enable/disable, directory config)
- Add dropdown offers: **Create Skill** (opens wizard dialog) and **Add Skills** (opens Finder)

`PluginSettings.tsx` reuses the Library plugin tabs inside Settings:

- **Installed**: user-installed plugins plus searchable built-ins; enable/disable,
  uninstall for non-built-ins, and manifest/config detail drawer
- **Marketplace**: **Available** catalog entries with Source and Type filters,
  plus **Sources** management for catalog URLs and trust level

## Integration

Agent code calls the compatibility skills API, but the returned skills come
from the plugin loader. Claude-compatible flat skills still work because
`~/.claude/skills/` directories are loaded as legacy skills. Profile and channel
restrictions continue to use skill slugs/names against the resolved skill list.

### Agent Profile Integration

Agent profiles control skill availability via the `default_skills` JSON column, which supports three states:

| Value | UI Label | Behavior |
|-------|----------|----------|
| `null` | "All Allowed" | All user and project skills are loaded; globally enabled skills remain available |
| `[]` | Restricted (none selected) | No skills are loaded; built-in MCP servers (media, speech) are blocked |
| `["slug-a", …]` | Restricted (specific skills) | Only listed skills are loaded; built-in MCP servers remain available |

**Frontend** (`McpSkillsPicker`): An "All Allowed" / "Restrict" toggle controls the `null` vs `string[]` state. When restricted, users select skills from the installed list. Stale slugs (installed but since removed) are shown with a remove affordance. All picker labels are localized via `t.profiles.*` keys.

**Backend validation**: Slugs are sanitized against `/^[a-z0-9_-]+$/i` and verified via parallel `fs.access()` checks. Invalid or stale slugs are silently dropped. The resolved skill list flows through `ResolvedAgentContext.profileAllowedSkills` to the agent adapter.

**Channel enforcement**: When a channel bot uses a profile, `getProfileSkillSlugs(profileId)` resolves the skill list and passes it as `pinnedSkills` to `runAgent()`, ensuring channel conversations respect the same restrictions as desktop tasks.

### Skill Manifest

The plugin skills loader builds a manifest of all available skills including
their `trigger` field (for slash-command-style activation), categories, tags,
icons, and metadata. The `SkillSelector` component groups skills by category
with pinned skills displayed at top.

---

*See also: [Plugins & Extensions](../plugins/index.md) · [MCP Integration](mcp.md) · [Agent System](agent-system.md)*
