# Example: saved search filters

Epic branch: epic/900-saved-filters

## User outcome

A user can save a task search as a named filter and reopen it from the sidebar.

## Non-goals

- Sharing filters between users.
- Changing the search query syntax.

## Accountable owner

@bravew

## Acceptance criteria

- [http-route] `POST /filters` stores a filter and `GET /filters` returns it after an API restart.
- [ui-flow] Saving a filter from the search bar shows it in the sidebar without a reload.

## Platform, branding and i18n

- User-facing text: yes
- Locales covered: en, zh, es, fr, hi, pt.
- Desktop and browser; product name comes from branding exports.

## Security and boundaries

- No outbound requests. Filter names are stored through the existing db operations.
- No new Tauri capability.

## Slices

### S1: filter storage API

- Owned files: src-api/src/app/api/filters.ts, src-api/test/unit/filters.test.ts
- Shared files: src-api/src/http-daemon.ts
- Depends on: none

### S2: sidebar UI

- Owned files: src/components/sidebar/SavedFilters.tsx
- Shared files: src/config/locale/messages/en/filters.ts
- Depends on: S1
