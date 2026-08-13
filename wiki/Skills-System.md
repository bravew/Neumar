# Skills System

Skills are reusable agent capabilities defined as Markdown files (`SKILL.md`). They extend what agents can do without writing code — from generating posters to running browser automation to creating scheduled tasks.

---

## What Is a Skill?

A skill is a `SKILL.md` file with a YAML frontmatter header and a Markdown body. The body is injected into the agent's system prompt when the skill is active, giving the agent specialized knowledge and instructions.

```markdown
---
name: canvas-design
displayName: Canvas Design
version: 1.0.0
description: Create beautiful visual designs as PNG and PDF documents
author: neuma-team
tags: [design, images, pdf]
---

# Canvas Design Skill

You are an expert visual designer. When asked to create designs...

## Guidelines
- Use high-contrast colors for readability
- Follow the golden ratio for layout proportions
...
```

---

## Skill Locations

Skills are loaded from three locations (in priority order):

| Location | Path | Notes |
|---|---|---|
| App skills | `~/.<slug>/skills/<name>/SKILL.md` | App-specific installs |
| Claude Code skills | `~/.claude/skills/<name>/SKILL.md` | Shared with Claude CLI |
| Built-in catalog | Bundled with the app | Read-only reference |

---

## Built-In Skills

The app ships with several built-in skills:

| Skill | Description |
|---|---|
| `canvas-design` | Create visual art as PNG/PDF using design philosophy |
| `scheduled-task` | Create recurring and one-time scheduled tasks |
| `weather` | Get current weather and forecasts (no API key needed) |
| `remotion` | Best practices for Remotion video creation in React |
| `react-best-practices` | React and Next.js optimization patterns |
| `yt-dlp` | Download videos from YouTube and other sites |
| `ffmpeg-media` | Local media processing with FFmpeg |
| `agent-browser` | Browser automation and web scraping |

---

## Skills UI

Skills are managed in **Settings → Skills**, which has three tabs:

### Installed Tab
Lists all installed skills with:
- Version badge
- Update available indicator (when catalog has a newer version)
- Remove button

### Marketplace Tab
Browses the skill catalog:
- Paginated search by name / slug / author
- One-click Install (copies to `~/.<slug>/skills/`)
- Version and description preview

### Settings Tab
- Default skill activation settings
- Create new skill (opens editor with template)

---

## Installing a Skill

### From the Marketplace

Settings → Skills → Marketplace → click **Install** on any skill.

The skill is copied to `~/.<slug>/skills/<slug>/SKILL.md`.

### Manually

Create a directory and file:

```bash
mkdir -p ~/.<slug>/skills/my-skill
cat > ~/.<slug>/skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
displayName: My Custom Skill
version: 1.0.0
description: Does something useful
author: me
tags: [custom]
---

# My Custom Skill

When activated, provide specialized behavior for...
EOF
```

The skill appears in Settings → Skills → Installed immediately.

---

## Creating a Skill

Click **Create** in the Skills settings tab. The app opens an editor pre-populated with the SKILL.md template. Fill in:

| Field | Required | Description |
|---|---|---|
| `name` | Yes | kebab-case identifier |
| `displayName` | Yes | Human-readable name |
| `version` | Yes | Semver (e.g., `1.0.0`) |
| `description` | Yes | One-line description |
| `author` | No | Your name or org |
| `tags` | No | Array of tag strings |

The body is freeform Markdown that becomes the agent's system prompt context when the skill is selected.

---

## Skill Catalog API

```
GET /files/skills-catalog
  ?page=1&limit=20&search=design
  → { skills: SkillMeta[], total: number }

POST /files/skills-catalog/install
  { slug: string }
  → { success: boolean }
```

The catalog index is a `_meta.json` file scanned with a 5-minute cache. Version comparison uses semver to detect updates.

---

## Using Skills in Tasks

When a task is submitted, any active skills are injected into the agent's system prompt. Skills can also be explicitly requested in the prompt:

```
Use the canvas-design skill to create a product landing page mockup
```

---

## Further Reading

- [[Agent System]] — How system prompts are assembled
- [[Configuration]] — Skill file locations
- [[API Reference]] — `/files/skills*` endpoints
