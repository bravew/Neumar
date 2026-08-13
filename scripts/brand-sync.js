#!/usr/bin/env node

/**
 * Brand Sync Script
 *
 * Reads brand config + assets from branding/<slug>/ and syncs them to the
 * project root and all downstream files.
 *
 * Brand selection:
 *   --brand=<slug>   Select which brand folder to use (e.g., --brand=my-brand)
 *                    Defaults to reading the slug from root branding.json if it exists.
 *
 * Files copied by this script:
 *   - branding/<slug>/branding.json  → branding.json (project root)
 *   - branding/<slug>/logo.png       → src/assets/logo.png
 *   - branding/<slug>/favicon.ico    → public/favicon.ico
 *   - branding/<slug>/app-icon.png   → public/app-icon.png
 *   - branding/<slug>/icons/         → src-tauri/icons/ (recursive)
 *
 * Files patched by this script:
 *   - src-api/src/config/branding.ts  (generated backend branding module)
 *   - index.html                       (<title> tag)
 *   - src-tauri/tauri.conf.json        (productName, identifier, externalBin)
 *   - src-tauri/Cargo.toml             (package name, lib name, description)
 *   - src-tauri/src/lib.rs             (sidecar name, db name)
 *   - src-tauri/src/main.rs            (Rust lib crate name call)
 *   - src-tauri/capabilities/default.json (FS scopes, sidecar permissions)
 *   - src/config/style/theme.css       (brand primary colors and shadow tints)
 *   - package.json                     (package name, pnpm filter references)
 *   - src-api/package.json             (API package name, binary build commands)
 *   - .github/workflows/build.yml      (CI binary names, release name)
 *
 * Files that self-configure from branding.json (NOT patched by this script):
 *   - scripts/ensure-api-binary.js     (reads branding.json at runtime)
 *   - scripts/build.sh                 (reads branding.json at runtime)
 *   - scripts/version.sh               (reads branding.json at runtime)
 *
 * Usage:
 *   node scripts/brand-sync.js                         # Sync active brand
 *   node scripts/brand-sync.js --brand=my-brand         # Sync specific brand
 *   node scripts/brand-sync.js --brand=default          # Switch to default brand
 *   node scripts/brand-sync.js --check                 # Check if files are in sync (CI mode)
 *   node scripts/brand-sync.js --plain                 # Use ASCII output (no emoji)
 *   CI=true node scripts/brand-sync.js                 # --plain is auto-enabled when CI env is set
 *
 * To rebrand: run `pnpm brand:sync -- --brand=<slug>`.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BRANDING_DIR = join(ROOT, 'branding');
const CHECK_MODE = process.argv.includes('--check');
const PLAIN_MODE = process.argv.includes('--plain') || !!process.env.CI;

// ============================================================================
// Output helpers — use ASCII in CI / --plain mode, emoji otherwise
// ============================================================================

const icons = PLAIN_MODE
  ? {
      tool: '[sync]',
      ok: '[ok]',
      fail: '[FAIL]',
      edit: '[edit]',
      warn: '[warn]',
      done: '[done]',
      err: '[ERR]',
      copy: '[copy]',
    }
  : {
      tool: '🔧',
      ok: '✓',
      fail: '✗',
      edit: '✏',
      warn: '⚠',
      done: '✅',
      err: '❌',
      copy: '📦',
    };

// ============================================================================
// Resolve brand slug
// ============================================================================

function resolveBrandSlug() {
  // Check for --brand=<slug> argument
  const brandArg = process.argv.find((arg) => arg.startsWith('--brand='));
  if (brandArg) {
    return brandArg.split('=')[1];
  }

  // Fall back to reading slug from root branding.json
  const rootBrandingPath = join(ROOT, 'branding.json');
  if (existsSync(rootBrandingPath)) {
    try {
      const rootBranding = JSON.parse(readFileSync(rootBrandingPath, 'utf-8'));
      if (rootBranding.slug) return rootBranding.slug;
    } catch {
      // Fall through to error
    }
  }

  // List available brands
  const available = [];
  if (existsSync(BRANDING_DIR)) {
    for (const entry of readdirSync(BRANDING_DIR)) {
      if (statSync(join(BRANDING_DIR, entry)).isDirectory()) {
        if (existsSync(join(BRANDING_DIR, entry, 'branding.json'))) {
          available.push(entry);
        }
      }
    }
  }

  console.error(
    `${icons.err} Cannot determine brand. Use --brand=<slug> to specify.`,
  );
  if (available.length > 0) {
    console.error(`   Available brands: ${available.join(', ')}`);
  }
  process.exit(1);
}

const brandSlug = resolveBrandSlug();
let brandDir = join(BRANDING_DIR, brandSlug);

// If folder name doesn't match slug directly, search by slug inside branding.json
if (!existsSync(brandDir) && existsSync(BRANDING_DIR)) {
  for (const entry of readdirSync(BRANDING_DIR)) {
    const candidateDir = join(BRANDING_DIR, entry);
    const candidateConfig = join(candidateDir, 'branding.json');
    if (statSync(candidateDir).isDirectory() && existsSync(candidateConfig)) {
      try {
        const cfg = JSON.parse(readFileSync(candidateConfig, 'utf-8'));
        if (cfg.slug === brandSlug) {
          brandDir = candidateDir;
          break;
        }
      } catch {
        // skip malformed configs
      }
    }
  }
}

if (!existsSync(brandDir)) {
  console.error(`${icons.err} Brand folder not found: branding/${brandSlug}/`);
  process.exit(1);
}

const brandConfigPath = join(brandDir, 'branding.json');
if (!existsSync(brandConfigPath)) {
  console.error(
    `${icons.err} Brand config not found: branding/${brandSlug}/branding.json`,
  );
  process.exit(1);
}

// ============================================================================
// Load branding config from brand folder
// ============================================================================

const branding = JSON.parse(readFileSync(brandConfigPath, 'utf-8'));

// ============================================================================
// Validate branding.json structure
// ============================================================================

/** All keys that BrandingConfig expects, organized by nesting level. */
const EXPECTED_SCHEMA = {
  root: [
    'displayName',
    'slug',
    'identifier',
    'tagline',
    'description',
    'copyrightHolder',
    'urls',
    'theme',
    'api',
  ],
  optionalRoot: ['site'],
  urls: ['website', 'download', 'support', 'docs'],
  theme: [
    'primaryColor',
    'primaryColorDark',
    'accentColorId',
    'accentColorName',
    'shadowColorLight',
    'shadowColorDark',
  ],
  api: ['binaryName'],
  site: ['apiBaseUrl'],
};

function validateBrandingSchema() {
  const errors = [];

  for (const key of EXPECTED_SCHEMA.root) {
    if (!(key in branding)) errors.push(`Missing root key: "${key}"`);
  }
  for (const key of EXPECTED_SCHEMA.urls) {
    if (!branding.urls || !(key in branding.urls))
      errors.push(`Missing urls.${key}`);
  }
  for (const key of EXPECTED_SCHEMA.theme) {
    if (!branding.theme || !(key in branding.theme))
      errors.push(`Missing theme.${key}`);
  }
  for (const key of EXPECTED_SCHEMA.api) {
    if (!branding.api || !(key in branding.api))
      errors.push(`Missing api.${key}`);
  }
  for (const key of EXPECTED_SCHEMA.site) {
    if (branding.site && !(key in branding.site))
      errors.push(`Missing site.${key}`);
  }

  // Warn about extra keys (may indicate branding.json has fields the types don't cover)
  const allowedRootKeys = new Set([
    ...EXPECTED_SCHEMA.root,
    ...EXPECTED_SCHEMA.optionalRoot,
  ]);
  const extraRoot = Object.keys(branding).filter(
    (k) => !allowedRootKeys.has(k),
  );
  for (const key of extraRoot) {
    errors.push(
      `Unexpected root key: "${key}" (add to BrandingConfig type or remove)`,
    );
  }

  if (errors.length > 0) {
    console.error(
      `${icons.err} branding/${brandSlug}/branding.json schema validation failed:`,
    );
    for (const err of errors) {
      console.error(`   - ${err}`);
    }
    console.error('   Update branding.json and the BrandingConfig types in:');
    console.error('     - src/config/branding.ts (frontend)');
    console.error(
      '     - scripts/brand-sync.js EXPECTED_SCHEMA + generateBackendBranding()',
    );
    process.exit(1);
  }
}

validateBrandingSchema();

// Derived values
const slug = branding.slug;
const displayName = branding.displayName;
const identifier = branding.identifier;
const binaryName = branding.api.binaryName;
const dataDir = `.${slug}`;
const dbName = `${slug}.db`;
const underscoreSlug = slug.replace(/-/g, '_');

const brandFolderName = basename(brandDir);
console.log(
  `${icons.tool} Brand sync: "${displayName}" (${slug}) from branding/${brandFolderName}/`,
);
if (CHECK_MODE) {
  console.log('   Running in check mode — no files will be written');
}

let hasChanges = false;

// ============================================================================
// Helper: Read, transform, and write (or check)
// ============================================================================

function syncFile(relPath, transform) {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) {
    console.warn(`   ${icons.warn} Skipping ${relPath} (file not found)`);
    return;
  }

  const original = readFileSync(fullPath, 'utf-8');
  const updated = transform(original);

  if (original === updated) {
    console.log(`   ${icons.ok} ${relPath} (already in sync)`);
    return;
  }

  if (CHECK_MODE) {
    console.log(`   ${icons.fail} ${relPath} (out of sync)`);
    hasChanges = true;
    return;
  }

  writeFileSync(fullPath, updated, 'utf-8');
  console.log(`   ${icons.edit} ${relPath} (updated)`);
}

// ============================================================================
// Helper: Copy a file from brand folder to runtime location (or check)
// ============================================================================

function syncAsset(brandRelPath, runtimeRelPath) {
  const src = join(brandDir, brandRelPath);
  const dest = join(ROOT, runtimeRelPath);

  if (!existsSync(src)) {
    console.warn(
      `   ${icons.warn} Skipping ${runtimeRelPath} (source not found: branding/${brandSlug}/${brandRelPath})`,
    );
    return;
  }

  // Ensure destination directory exists
  const destDir = dirname(dest);
  if (!existsSync(destDir)) {
    if (CHECK_MODE) {
      console.log(
        `   ${icons.fail} ${runtimeRelPath} (destination directory missing)`,
      );
      hasChanges = true;
      return;
    }
    mkdirSync(destDir, { recursive: true });
  }

  // For binary files, compare buffers
  const srcBuf = readFileSync(src);
  if (existsSync(dest)) {
    const destBuf = readFileSync(dest);
    if (srcBuf.equals(destBuf)) {
      console.log(`   ${icons.ok} ${runtimeRelPath} (already in sync)`);
      return;
    }
  }

  if (CHECK_MODE) {
    console.log(`   ${icons.fail} ${runtimeRelPath} (out of sync)`);
    hasChanges = true;
    return;
  }

  writeFileSync(dest, srcBuf);
  console.log(`   ${icons.copy} ${runtimeRelPath} (copied)`);
}

// ============================================================================
// Helper: Recursively copy a directory from brand folder (or check)
// ============================================================================

function syncAssetDir(brandRelDir, runtimeRelDir) {
  const srcDir = join(brandDir, brandRelDir);
  if (!existsSync(srcDir)) {
    console.warn(
      `   ${icons.warn} Skipping ${runtimeRelDir}/ (source not found: branding/${brandSlug}/${brandRelDir}/)`,
    );
    return;
  }

  function walkAndSync(relPath) {
    const fullSrc = join(srcDir, relPath);
    const stat = statSync(fullSrc);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(fullSrc)) {
        walkAndSync(join(relPath, entry));
      }
    } else {
      syncAsset(join(brandRelDir, relPath), join(runtimeRelDir, relPath));
    }
  }

  walkAndSync('');
}

// ============================================================================
// 0. Copy brand config + assets to runtime locations
// ============================================================================

console.log(`\n   Syncing brand config and assets...`);

// Copy branding.json to root
syncFile('branding.json', () => {
  // Always overwrite root branding.json with brand folder's config
  return JSON.stringify(branding, null, 2) + '\n';
});

// If root branding.json doesn't exist yet, create it
if (!existsSync(join(ROOT, 'branding.json')) && !CHECK_MODE) {
  writeFileSync(
    join(ROOT, 'branding.json'),
    JSON.stringify(branding, null, 2) + '\n',
    'utf-8',
  );
  console.log(`   ${icons.copy} branding.json (created)`);
}

// Copy visual assets
syncAsset('logo.png', 'src/assets/logo.png');
syncAsset('favicon.ico', 'public/favicon.ico');
syncAsset('app-icon.png', 'public/app-icon.png');
syncAssetDir('icons', 'src-tauri/icons');

// ============================================================================
// 1. Generate backend branding module
// ============================================================================

console.log(`\n   Patching downstream files...`);

function generateBackendBranding() {
  const fullPath = join(ROOT, 'src-api/src/config/branding.ts');

  // Generate backend branding module with the same rich sub-interfaces as the
  // frontend (src/config/branding.ts). Keeping both type definitions structurally
  // identical ensures cross-layer consistency. The EXPECTED_SCHEMA validation above
  // catches any branding.json / type definition drift at build time.
  const fixedContent = `/**
 * Branding Configuration — Backend (Auto-Generated)
 *
 * ⚠️  THIS FILE IS AUTO-GENERATED from /branding.json
 *     Do not edit directly. Run \`pnpm brand:sync\` to regenerate.
 *
 * To rebrand: edit /branding.json then run \`pnpm brand:sync\`.
 *
 * NOTE: The type definitions below mirror src/config/branding.ts (frontend).
 * If you add a field, update both files and the EXPECTED_SCHEMA in brand-sync.js.
 */

// ============================================================================
// Branding Type Definitions (mirrors src/config/branding.ts)
// ============================================================================

export interface BrandingUrls {
  /** Main product website */
  website: string;
  /** Download page URL */
  download: string;
  /** Support/help URL */
  support: string;
  /** Documentation URL */
  docs: string;
}

export interface BrandingTheme {
  /** Primary brand color in OKLCH format (light mode) */
  primaryColor: string;
  /** Primary brand color in OKLCH format (dark mode) */
  primaryColorDark: string;
  /** Machine-readable ID for the brand accent color (e.g., "brand") */
  accentColorId: string;
  /** Human-readable name for the brand accent color (e.g., "Brand") */
  accentColorName: string;
  /** Shadow tint color for light mode (hex) */
  shadowColorLight: string;
  /** Shadow tint color for dark mode (hex) */
  shadowColorDark: string;
}

export interface BrandingApi {
  /** Base name for the compiled API binary */
  binaryName: string;
}

export interface BrandingSite {
  /** Base URL for the companion web app API */
  apiBaseUrl?: string;
}

export interface BrandingConfig {
  /** Display name shown to users */
  displayName: string;
  /** URL-safe slug, lowercase with hyphens */
  slug: string;
  /** Reverse-domain identifier */
  identifier: string;
  /** Short tagline / subtitle */
  tagline: string;
  /** Full description for about pages */
  description: string;
  /** Copyright holder name */
  copyrightHolder: string;
  /** Product URLs */
  urls: BrandingUrls;
  /** Theme / visual identity */
  theme: BrandingTheme;
  /** API configuration */
  api: BrandingApi;
  /** Companion web site configuration */
  site?: BrandingSite;
}

// ============================================================================
// Branding Values
// ============================================================================

export const branding: BrandingConfig = ${JSON.stringify(branding, null, 2)};

// ============================================================================
// Convenience Exports
// ============================================================================

/** Application display name (from branding.json) */
export const APP_DISPLAY_NAME = branding.displayName;

/** Application URL-safe slug (from branding.json) */
export const APP_SLUG = branding.slug;

/** User data directory name, derived from slug */
export const APP_DATA_DIR = \`.\${branding.slug}\`;

/** SQLite database name, derived from slug */
export const APP_DB_NAME = \`\${branding.slug}.db\`;
`;

  if (existsSync(fullPath)) {
    const original = readFileSync(fullPath, 'utf-8');
    if (original === fixedContent) {
      console.log(
        `   ${icons.ok} src-api/src/config/branding.ts (already in sync)`,
      );
      return;
    }
  }

  if (CHECK_MODE) {
    console.log(
      `   ${icons.fail} src-api/src/config/branding.ts (out of sync)`,
    );
    hasChanges = true;
    return;
  }

  writeFileSync(fullPath, fixedContent, 'utf-8');
  console.log(`   ${icons.edit} src-api/src/config/branding.ts (generated)`);
}

generateBackendBranding();

// ============================================================================
// 2. index.html — <title> tag
// ============================================================================

syncFile('index.html', (content) => {
  return content.replace(
    /<title>.*?<\/title>/,
    `<title>${displayName}</title>`,
  );
});

// ============================================================================
// 3. src-tauri/tauri.conf.json
// ============================================================================

syncFile('src-tauri/tauri.conf.json', (content) => {
  const conf = JSON.parse(content);

  conf.productName = displayName;
  conf.identifier = identifier;

  // Update externalBin entries that reference the API binary
  if (conf.bundle?.externalBin) {
    conf.bundle.externalBin = conf.bundle.externalBin.map((bin) => {
      // Match any path ending with an API binary name pattern
      if (bin.match(/[/\\][a-z]+-[a-z]+-api$/)) {
        const dir = bin.substring(0, bin.lastIndexOf('/') + 1);
        return `${dir}${binaryName}`;
      }
      return bin;
    });
  }

  return JSON.stringify(conf, null, 2) + '\n';
});

// ============================================================================
// 4. src-tauri/Cargo.toml
// ============================================================================

syncFile('src-tauri/Cargo.toml', (content) => {
  return content
    .replace(/^name = ".*?"$/m, `name = "${slug}"`)
    .replace(/^name = ".*?_lib"$/m, `name = "${underscoreSlug}_lib"`)
    .replace(
      /^description = ".*?"$/m,
      `description = "${branding.description}"`,
    );
});

// ============================================================================
// 5. src-tauri/src/lib.rs — sidecar name and DB name
// ============================================================================

syncFile('src-tauri/src/lib.rs', (content) => {
  // Update SQLite DB name: "sqlite:xxx.db"
  content = content.replace(
    /("sqlite:)[a-z][-a-z0-9]*\.db(")/g,
    `$1${dbName}$2`,
  );

  // Update sidecar name: sidecar("xxx-api")
  content = content.replace(
    /sidecar\("[a-z][-a-z0-9]*-api"\)/g,
    `sidecar("${binaryName}")`,
  );

  return content;
});

// ============================================================================
// 6. src-tauri/capabilities/default.json
// ============================================================================

syncFile('src-tauri/capabilities/default.json', (content) => {
  const conf = JSON.parse(content);

  // Update FS scope: $HOME/.<slug>/**
  if (conf.permissions) {
    conf.permissions = conf.permissions.map((perm) => {
      if (
        typeof perm === 'object' &&
        perm.identifier === 'fs:scope' &&
        perm.allow
      ) {
        // Ensure the app data dir scope exists, update existing app scope entries
        let hasAppScope = false;
        perm.allow = perm.allow.map((p) => {
          // Match app data dir patterns (not .claude or other known dirs)
          if (
            p.match(/^\$HOME\/\.[a-z][-a-z0-9]*\/\*\*$/) &&
            !p.includes('.claude')
          ) {
            hasAppScope = true;
            return `$HOME/${dataDir}/**`;
          }
          return p;
        });
        // Add app scope if not present
        if (!hasAppScope) {
          perm.allow.unshift(`$HOME/${dataDir}/**`);
        }
        // Deduplicate
        perm.allow = [...new Set(perm.allow)];
      }
      // Update sidecar execute permission
      if (
        typeof perm === 'object' &&
        perm.identifier === 'shell:allow-execute' &&
        perm.allow
      ) {
        perm.allow = perm.allow.map((entry) => {
          if (
            entry.sidecar &&
            entry.name &&
            entry.name.match(/^[a-z][-a-z0-9]*-api$/)
          ) {
            return { ...entry, name: binaryName };
          }
          return entry;
        });
      }
      return perm;
    });
  }

  return JSON.stringify(conf, null, 2) + '\n';
});

// ============================================================================
// 7. src/config/style/theme.css — brand colors
// ============================================================================

syncFile('src/config/style/theme.css', (content) => {
  const primary = branding.theme.primaryColor;
  const primaryDark = branding.theme.primaryColorDark;
  const shadowLight = branding.theme.shadowColorLight;
  const shadowDark = branding.theme.shadowColorDark;

  // Track match counts to warn if a regex didn't find its target.
  // We count matches (not changes) so already-in-sync files don't trigger false positives.
  let matches = 0;
  const tracked = (regex, replacement) => {
    if (regex.test(content)) matches++;
    content = content.replace(regex, replacement);
    return content;
  };

  // Light mode: update --primary, --ring, --chart-1, --sidebar-primary, --sidebar-ring
  // These all share the same brand color in :root
  tracked(/(:root\s*\{[\s\S]*?--primary:\s*)oklch\([^)]+\)/, `$1${primary}`);
  tracked(/(:root\s*\{[\s\S]*?--ring:\s*)oklch\([^)]+\)/, `$1${primary}`);
  tracked(/(:root\s*\{[\s\S]*?--chart-1:\s*)oklch\([^)]+\)/, `$1${primary}`);
  tracked(
    /(:root\s*\{[\s\S]*?--sidebar-primary:\s*)oklch\([^)]+\)/,
    `$1${primary}`,
  );
  tracked(
    /(:root\s*\{[\s\S]*?--sidebar-ring:\s*)oklch\([^)]+\)/,
    `$1${primary}`,
  );

  // Light mode shadow color (matches both #hex and oklch(...) formats)
  tracked(
    /(:root\s*\{[\s\S]*?--shadow-color:\s*)(?:#[0-9a-fA-F]+|oklch\([^)]+\))/,
    `$1${shadowLight}`,
  );

  // Dark mode: update --primary, --ring, --chart-1, --sidebar-primary, --sidebar-ring
  tracked(
    /(\.dark\s*\{[\s\S]*?--primary:\s*)oklch\([^)]+\)/,
    `$1${primaryDark}`,
  );
  tracked(/(\.dark\s*\{[\s\S]*?--ring:\s*)oklch\([^)]+\)/, `$1${primaryDark}`);
  tracked(
    /(\.dark\s*\{[\s\S]*?--chart-1:\s*)oklch\([^)]+\)/,
    `$1${primaryDark}`,
  );
  tracked(
    /(\.dark\s*\{[\s\S]*?--sidebar-primary:\s*)oklch\([^)]+\)/,
    `$1${primaryDark}`,
  );
  tracked(
    /(\.dark\s*\{[\s\S]*?--sidebar-ring:\s*)oklch\([^)]+\)/,
    `$1${primaryDark}`,
  );

  // Dark mode shadow color (matches both #hex and oklch(...) formats)
  tracked(
    /(\.dark\s*\{[\s\S]*?--shadow-color:\s*)(?:#[0-9a-fA-F]+|oklch\([^)]+\))/,
    `$1${shadowDark}`,
  );

  // Validate: we expect 12 CSS variable matches (6 light + 6 dark)
  const EXPECTED_MATCHES = 12;
  if (matches < EXPECTED_MATCHES) {
    console.warn(
      `   ${icons.warn} theme.css: only ${matches}/${EXPECTED_MATCHES} CSS variables matched. ` +
        `Check that the CSS structure hasn't changed.`,
    );
  }

  return content;
});

// ============================================================================
// 8. src-tauri/src/main.rs — Rust lib crate name
// ============================================================================

syncFile('src-tauri/src/main.rs', (content) => {
  // Update the lib crate call: <old_slug>_lib::run() → <new_slug>_lib::run()
  return content.replace(
    /[a-z][a-z0-9_]*_lib::run\(\)/g,
    `${underscoreSlug}_lib::run()`,
  );
});

// ============================================================================
// 9. package.json — root package name and pnpm filter references
// ============================================================================

syncFile('package.json', (content) => {
  const pkg = JSON.parse(content);

  // Update package name
  pkg.name = slug;

  // Update pnpm filter references in scripts
  // Filters reference the API package by name (e.g., "pnpm --filter <slug>-api dev")
  const apiPkgName = `${slug}-api`;
  if (pkg.scripts) {
    for (const [key, val] of Object.entries(pkg.scripts)) {
      if (typeof val === 'string' && val.includes('--filter')) {
        pkg.scripts[key] = val.replace(
          /--filter\s+[a-z][-a-z0-9]*-api/g,
          `--filter ${apiPkgName}`,
        );
      }
    }
  }

  return JSON.stringify(pkg, null, 2) + '\n';
});

// ============================================================================
// 10. src-api/package.json — API package name and binary build references
// ============================================================================

syncFile('src-api/package.json', (content) => {
  const pkg = JSON.parse(content);

  // Update package name
  pkg.name = `${slug}-api`;

  // Update binary name in build scripts
  if (pkg.scripts) {
    for (const [key, val] of Object.entries(pkg.scripts)) {
      if (typeof val === 'string') {
        pkg.scripts[key] = val.replace(
          /[a-z]+-[a-z]+-api(?=-(?:aarch64|x86_64))/g,
          binaryName,
        );
      }
    }
  }

  return JSON.stringify(pkg, null, 2) + '\n';
});

// ============================================================================
// 11. .github/workflows/build.yml — CI binary names and release name
// ============================================================================

syncFile('.github/workflows/build.yml', (content) => {
  // PascalCase slug for artifact names (e.g., "MyApp" from "my-app")
  const pascalSlug = slug
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  // a) Replace binary name in outfile paths (e.g., dist/<binaryName>-${{ matrix.rust_target }})
  content = content.replace(
    /dist\/[a-z]+-[a-z]+-api-\$\{\{/g,
    `dist/${binaryName}-\${{`,
  );

  // b) Replace release name (e.g., "<displayName> v${{ ... }}")
  content = content.replace(
    /name:\s+[A-Z][a-zA-Z ]+\s+v\$\{\{/g,
    `name: ${displayName} v\${{`,
  );

  // c) Replace artifact names (e.g., "MyApp-${{ matrix.name }}")
  content = content.replace(
    /name:\s+[A-Z][a-zA-Z]+-\$\{\{\s*matrix\.name\s*\}\}/g,
    `name: ${pascalSlug}-\${{ matrix.name }}`,
  );

  // d) Replace /usr/lib/<DisplayName>/ paths in comments and base64 scripts
  //    Match multi-word PascalCase app names in /usr/lib/ paths
  content = content.replace(
    /\/usr\/lib\/[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\//g,
    `/usr/lib/${displayName}/`,
  );

  // e) Regenerate base64-encoded CLI launcher scripts with correct branding.
  //    The launcher scripts search for the cli-bundle directory in known paths
  //    including /usr/lib/<displayName>/ for Linux Tauri packages.
  const noSpaceSlug = slug.replace(/-/g, '');

  /**
   * Generate a CLI launcher bash script that searches for the cli-bundle
   * directory in standard Tauri resource locations.
   * @param {string} cliModule - npm module path (e.g., "@anthropic-ai/claude-code/cli.js")
   */
  function makeLauncher(cliModule) {
    return [
      '#!/bin/bash',
      'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
      'for DIR in "$SCRIPT_DIR/cli-bundle" \\',
      '           "$SCRIPT_DIR/_up_/src-api/dist/cli-bundle" \\',
      '           "$SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" \\',
      '           "$SCRIPT_DIR/../Resources/cli-bundle" \\',
      `           "$SCRIPT_DIR/../lib/${displayName}/_up_/src-api/dist/cli-bundle" \\`,
      `           "$SCRIPT_DIR/../lib/${noSpaceSlug}/_up_/src-api/dist/cli-bundle"; do`,
      '    if [ -f "$DIR/node" ] && [ -d "$DIR/node_modules" ]; then',
      '        BUNDLE_DIR="$DIR"',
      '        break',
      '    fi',
      'done',
      'if [ -z "$BUNDLE_DIR" ]; then',
      '    echo "Error: cli-bundle not found. Searched paths:" >&2',
      '    echo "  - $SCRIPT_DIR/cli-bundle" >&2',
      '    echo "  - $SCRIPT_DIR/_up_/src-api/dist/cli-bundle" >&2',
      '    echo "  - $SCRIPT_DIR/../Resources/_up_/src-api/dist/cli-bundle" >&2',
      `    echo "  - $SCRIPT_DIR/../lib/${displayName}/_up_/src-api/dist/cli-bundle" >&2`,
      '    exit 1',
      'fi',
      `exec "$BUNDLE_DIR/node" "$BUNDLE_DIR/node_modules/${cliModule}" "$@"`,
      '',
    ].join('\n');
  }

  const claudeB64 = Buffer.from(
    makeLauncher('@anthropic-ai/claude-code/cli.js'),
  ).toString('base64');
  const codexB64 = Buffer.from(
    makeLauncher('@openai/codex/bin/codex.js'),
  ).toString('base64');

  // Replace the claude launcher base64 blob (long base64 string followed by: | base64 -d > claude)
  content = content.replace(
    /echo "[A-Za-z0-9+/=]+" \| base64 -d > claude\b/g,
    `echo "${claudeB64}" | base64 -d > claude`,
  );

  // Replace the codex launcher base64 blob (long base64 string followed by: | base64 -d > codex)
  content = content.replace(
    /echo "[A-Za-z0-9+/=]+" \| base64 -d > codex\b/g,
    `echo "${codexB64}" | base64 -d > codex`,
  );

  return content;
});

// NOTE: scripts/ensure-api-binary.js, scripts/build.sh, and scripts/version.sh
// are NOT patched here — they read branding.json directly at runtime.
// This avoids fragile regex replacements on dynamic script content.

// ============================================================================
// Done
// ============================================================================

if (CHECK_MODE && hasChanges) {
  console.log(
    `\n${icons.err} Some files are out of sync. Run \`pnpm brand:sync\` to fix.`,
  );
  process.exit(1);
}

if (!CHECK_MODE) {
  console.log(`\n${icons.done} Brand sync complete!`);
}
