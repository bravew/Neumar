# Neuma integration

This reference contains only Neuma-owned rules. HyperFrames authoring and CLI
knowledge must come from the pinned upstream skills.

## Project and asset conventions

- Work inside the user-configured workspace. Never resolve a composition or
  output path outside its Video project root.
- Keep editable composition source in the project's `hyperframes/` directory.
  Keep render caches under the project cache tree, including
  `hyperframes-extract/` for extracted source frames.
- Reuse assets already registered in the Video project. Do not download or
  server-fetch a user-supplied URL without the repository SSRF validator.
- Use Neuma's render engine adapter for product renders. Do not spawn a second
  unmanaged preview or render process from agent code.

## Upgrade policy

Use the installed, pinned CLI and an explicit project directory:

```bash
pnpm -C src-video exec hyperframes upgrade --project . --check --json
```

The check is read-only. Parse `_meta.version`, `_meta.latestVersion`, and
`_meta.updateAvailable`; report the installed-to-available version transition.
Ask the user before any command that changes a project pin or generated skill.
Never use `npx hyperframes@latest` as an automatic pre-render action.

After an approved upgrade, run the project's HyperFrames check and Neuma's
relevant render tests. A passing structural check does not prove frame parity,
so call out that limitation and preserve the old pin until verification passes.

## Studio and selection

- Open Studio through Neuma's managed preview route. It owns loopback ports,
  reference counting, and project-specific cleanup.
- Use `video_get_html_selection` for selection context. Prefer `data-hf-id`; do
  not guess a target from a screenshot when Studio reports no selection.
- Keep the hash-bearing Studio URL returned by the bridge. Removing
  `#project/<name>` breaks project navigation.
