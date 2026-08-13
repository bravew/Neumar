#!/bin/bash

# Release Script
# Usage: ./scripts/release.sh [major|minor|patch|x.y.z]
#
# Automates the full release process:
#   1. Bumps version in package.json, src-api/package.json, tauri.conf.json, Cargo.toml
#   2. Regenerates Cargo.lock
#   3. Generates changelog from conventional commits since last tag
#   4. Creates a release commit and git tag
#
# The CI release workflow (.github/workflows/build.yml) triggers on tag push
# and builds cross-platform binaries automatically.

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
DIM='\033[2m'
NC='\033[0m'

step() { printf '\n%b==>%b %s\n' "$BLUE" "$NC" "$1"; }
ok()   { printf '  %bok%b %s\n' "$GREEN" "$NC" "$1"; }
fail() { printf '  %berror%b %s\n' "$RED" "$NC" "$1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

BRAND_DISPLAY_NAME=$(node -e "console.log(require('./branding.json').displayName)")

# ---------------------------------------------------------------------------
# Check required tools
# ---------------------------------------------------------------------------

for cmd in node cargo git pnpm; do
    command -v "$cmd" >/dev/null 2>&1 || fail "Required tool not found: $cmd"
done

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------

if [ -z "${1:-}" ]; then
    echo "Usage: ./scripts/release.sh [major|minor|patch|x.y.z]"
    echo ""
    echo "Examples:"
    echo "  ./scripts/release.sh patch   # 26.3.4 -> 26.3.5"
    echo "  ./scripts/release.sh minor   # 26.3.4 -> 26.4.0"
    echo "  ./scripts/release.sh major   # 26.3.4 -> 27.0.0"
    echo "  ./scripts/release.sh 26.4.0  # explicit version"
    exit 1
fi

# ---------------------------------------------------------------------------
# Read current version from package.json
# ---------------------------------------------------------------------------

CURRENT_VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case "$1" in
    major) NEW_VERSION="$((MAJOR + 1)).0.0" ;;
    minor) NEW_VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
    patch) NEW_VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
    *)
        if [[ ! "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            fail "Invalid version format. Use x.y.z (e.g., 26.4.0)"
        fi
        NEW_VERSION="$1"
        ;;
esac

printf '%b%s Release%b\n' "$BLUE" "$BRAND_DISPLAY_NAME" "$NC"
printf '  current : %b%s%b\n' "$DIM" "$CURRENT_VERSION" "$NC"
printf '  next    : %b%s%b\n' "$GREEN" "$NEW_VERSION" "$NC"
echo ""

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

step "Running pre-flight checks"

if [[ -n $(git status --porcelain) ]]; then
    fail "Uncommitted changes detected. Commit or stash them first."
fi
ok "Working tree clean"

CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    printf '  %bwarning%b You are on branch '\''%s'\'', not '\''main'\''.\n' "$YELLOW" "$NC" "$CURRENT_BRANCH"
    read -p "  Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
else
    ok "On branch main"
fi

if git tag | grep -q "^v${NEW_VERSION}$"; then
    fail "Tag v${NEW_VERSION} already exists."
fi
ok "Tag v${NEW_VERSION} is available"

# ---------------------------------------------------------------------------
# Confirm
# ---------------------------------------------------------------------------

read -p "Proceed with release v${NEW_VERSION}? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
fi

# ---------------------------------------------------------------------------
# Bump versions (reuses version.sh logic for all 4 files)
# ---------------------------------------------------------------------------

step "Updating version numbers"

node -e "
const fs = require('fs');
const version = '${NEW_VERSION}';

// package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// src-api/package.json
const apiPkg = JSON.parse(fs.readFileSync('src-api/package.json', 'utf-8'));
apiPkg.version = version;
fs.writeFileSync('src-api/package.json', JSON.stringify(apiPkg, null, 2) + '\n');

// src-tauri/tauri.conf.json
const conf = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf-8'));
conf.version = version;
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(conf, null, 2) + '\n');

// src-tauri/Cargo.toml
const cargo = fs.readFileSync('src-tauri/Cargo.toml', 'utf-8');
fs.writeFileSync('src-tauri/Cargo.toml',
    cargo.replace(/^(version\s*=\s*)\"[^\"]*\"/m, \\\`\\\$1\\\"\${version}\\\"\\\`)
);
"
ok "package.json"
ok "src-api/package.json"
ok "src-tauri/tauri.conf.json"
ok "src-tauri/Cargo.toml"

# ---------------------------------------------------------------------------
# Regenerate Cargo.lock
# ---------------------------------------------------------------------------

step "Regenerating Cargo.lock"
(cd src-tauri && cargo generate-lockfile --quiet)
ok "Cargo.lock"

# ---------------------------------------------------------------------------
# Generate changelog entry and insert into CHANGELOG.md
# ---------------------------------------------------------------------------

step "Generating changelog"

LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "")
if [ -n "$LAST_TAG" ]; then
    RANGE="${LAST_TAG}..HEAD"
else
    RANGE="HEAD"
fi

TODAY=$(date +%Y-%m-%d)

CHANGELOG_ENTRY=$(node -e "
const { execSync } = require('child_process');
const fs = require('fs');

const range = '${RANGE}';
const version = '${NEW_VERSION}';
const today = '${TODAY}';

// Parse conventional commits
let log = '';
try {
    log = execSync(
        'git log ' + range + ' --pretty=format:\"%s\" --reverse',
        { encoding: 'utf-8' }
    );
} catch (e) {
    log = '';
}
const lines = log.split('\n').filter(Boolean);

const added = [];
const fixed = [];
const changed = [];

const pattern = /^(feat|fix|refactor|perf|build|style|docs|test|chore)(\(.*?\))?\!?:\s(.+)$/;

for (const line of lines) {
    const m = line.match(pattern);
    if (!m) continue;
    const [, type, scope, msg] = m;
    const entry = scope
        ? '**' + scope.slice(1, -1) + '**: ' + msg
        : msg;
    switch (type) {
        case 'feat': added.push(entry); break;
        case 'fix': fixed.push(entry); break;
        case 'refactor': case 'perf': case 'style': changed.push(entry); break;
    }
}

// Build changelog section
let entry = '## [' + version + '] - ' + today;
let hasContent = false;

if (added.length) {
    entry += '\n\n### Added\n\n' + added.map(e => '- ' + e).join('\n');
    hasContent = true;
}
if (fixed.length) {
    entry += '\n\n### Fixed\n\n' + fixed.map(e => '- ' + e).join('\n');
    hasContent = true;
}
if (changed.length) {
    entry += '\n\n### Changed\n\n' + changed.map(e => '- ' + e).join('\n');
    hasContent = true;
}
if (!hasContent) {
    entry += '\n\nMaintenance release.';
}

// Insert into CHANGELOG.md (create if missing)
const changelogPath = 'CHANGELOG.md';
let changelog = '';
if (fs.existsSync(changelogPath)) {
    changelog = fs.readFileSync(changelogPath, 'utf-8');
}

const marker = '\n## [';
const idx = changelog.indexOf(marker);

if (idx !== -1) {
    const before = changelog.slice(0, idx);
    const after = changelog.slice(idx);
    fs.writeFileSync(changelogPath, before + '\n\n' + entry + '\n' + after);
} else if (changelog.trim()) {
    fs.writeFileSync(changelogPath, changelog.trimEnd() + '\n\n' + entry + '\n');
} else {
    fs.writeFileSync(changelogPath, '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\nThe format is based on [Keep a Changelog](https://keepachangelog.com/).\n\n' + entry + '\n');
}

// Output entry for preview
process.stdout.write(entry);
")

ok "CHANGELOG.md"

# Show the generated changelog for review
echo ""
printf '%b--- changelog preview ---%b\n' "$DIM" "$NC"
echo "$CHANGELOG_ENTRY"
printf '%b--- end preview ---%b\n' "$DIM" "$NC"
echo ""

read -p "Does the changelog look good? (y/n) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Edit CHANGELOG.md manually, then run:"
    echo "  git add package.json src-api/package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md"
    echo "  git commit -m \"chore: release v${NEW_VERSION}\""
    echo "  git tag -a v${NEW_VERSION} -m \"Release v${NEW_VERSION}\""
    echo "  git push origin main --tags"
    exit 0
fi

# ---------------------------------------------------------------------------
# Git commit and tag
# ---------------------------------------------------------------------------

step "Creating release commit"

git add package.json src-api/package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json CHANGELOG.md
git commit -m "chore: release v${NEW_VERSION}"
ok "Committed"

step "Creating tag v${NEW_VERSION}"
git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
ok "Tagged"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------

echo ""
printf '%b========================================%b\n' "$GREEN" "$NC"
printf '%b  %s v%s released!%b\n' "$GREEN" "$BRAND_DISPLAY_NAME" "$NEW_VERSION" "$NC"
printf '%b========================================%b\n' "$GREEN" "$NC"
echo ""
echo "Next steps:"
echo "  1. Review the commit:  git show HEAD"
echo "  2. Push to trigger CI: git push origin main --tags"
echo ""
echo "  CI will build cross-platform binaries and create a draft GitHub release."
echo ""
echo "To undo this release:"
echo "  git tag -d v${NEW_VERSION} && git reset --soft HEAD~1"
