#!/bin/bash
# Upload release artifacts + latest.json to Cloudflare R2, then purge the
# Cloudflare CDN cache for the stable URLs that were overwritten.
#
# Usage: ./scripts/r2-upload.sh
#
# Required env vars:
#   CF_ACCOUNT_ID            Cloudflare account ID
#   CF_R2_ACCESS_KEY_ID      R2 API token access key
#   CF_R2_SECRET_ACCESS_KEY  R2 API token secret
#   VERSION                  Release version (e.g., "26.4.0")
#   R2_BUCKET                Bucket name (default: "neumar")
#   R2_PUBLIC_URL            Public URL (default: "https://cdn.neumar.app")
#   RELEASE_DIR              Directory with build artifacts (default: "release-files")
#
# Optional env vars:
#   DRY_RUN                  true/false, generate latest.json and print uploads
#                            without calling AWS or Cloudflare (default: false)
#   R2_UPLOAD_MAX_ATTEMPTS   Upload attempts for transient failures (default: 4)
#   R2_UPLOAD_BASE_DELAY     Initial retry delay in seconds (default: 2)
#   R2_UPLOAD_MAX_DELAY      Retry delay cap in seconds (default: 20)
#
# Optional env vars (enables CDN cache purge after upload):
#   CF_API_TOKEN             API token with `Zone.Cache Purge: Purge` permission,
#                            scoped to the zone serving R2_PUBLIC_URL.
#   CF_ZONE_ID               Zone ID for R2_PUBLIC_URL's domain.
#
# Without CF_API_TOKEN/CF_ZONE_ID the script still uploads, but stale copies of
# installer/*.dmg, installer/*.exe, latest.json, etc. may be served from
# Cloudflare's edge cache for up to their max-age (60s for installers and the
# manifest; the must-revalidate directive bounds it precisely there).

set -euo pipefail

VERSION="${VERSION:?VERSION is required}"
R2_BUCKET="${R2_BUCKET:-neumar}"
R2_PUBLIC_URL="${R2_PUBLIC_URL:-https://cdn.neumar.app}"
RELEASE_DIR="${RELEASE_DIR:-release-files}"
DRY_RUN="${DRY_RUN:-false}"
R2_UPLOAD_MAX_ATTEMPTS="${R2_UPLOAD_MAX_ATTEMPTS:-4}"
R2_UPLOAD_BASE_DELAY="${R2_UPLOAD_BASE_DELAY:-2}"
R2_UPLOAD_MAX_DELAY="${R2_UPLOAD_MAX_DELAY:-20}"

if [ "$DRY_RUN" != "true" ] && [ "$DRY_RUN" != "false" ]; then
  echo "DRY_RUN must be true or false" >&2
  exit 1
fi

if [ "$DRY_RUN" = "false" ]; then
  R2_ENDPOINT="https://${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required}.r2.cloudflarestorage.com"

  # Configure AWS CLI for R2 (S3-compatible)
  export AWS_ACCESS_KEY_ID="${CF_R2_ACCESS_KEY_ID:?CF_R2_ACCESS_KEY_ID is required}"
  export AWS_SECRET_ACCESS_KEY="${CF_R2_SECRET_ACCESS_KEY:?CF_R2_SECRET_ACCESS_KEY is required}"
  export AWS_DEFAULT_REGION="auto"
else
  R2_ENDPOINT="dry-run"
fi

is_permanent_upload_error() {
  local status="$1" output="$2"
  [ "$status" -eq 0 ] && return 1
  printf '%s' "$output" | grep -Eiq \
    'AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|ExpiredToken|AuthorizationHeaderMalformed|InvalidRequest|NoSuchBucket|(^|[^0-9])4[0-9]{2}([^0-9]|$)'
}

is_transient_upload_error() {
  local status="$1" output="$2"
  [ "$status" -eq 0 ] && return 1
  printf '%s' "$output" | grep -Eiq \
    'ECONNRESET|ETIMEDOUT|EPIPE|connection reset|socket hang up|timed out|timeout|temporar|SlowDown|Throttl|RequestTimeout|InternalError|ServiceUnavailable|(^|[^0-9])5[0-9]{2}([^0-9]|$)'
}

retry_delay_for_attempt() {
  local attempt="$1"
  local delay="$R2_UPLOAD_BASE_DELAY"
  local i=1
  while [ "$i" -lt "$attempt" ]; do
    delay=$((delay * 2))
    i=$((i + 1))
  done
  if [ "$delay" -gt "$R2_UPLOAD_MAX_DELAY" ]; then
    delay="$R2_UPLOAD_MAX_DELAY"
  fi
  if [ "$delay" -le 0 ]; then
    echo 0
    return
  fi
  echo $((delay + (RANDOM % delay + 1)))
}

upload_s3() {
  local label="$1"
  shift

  if [ "$DRY_RUN" = "true" ]; then
    echo "    dry-run: ${label}"
    return 0
  fi

  local attempt=1
  local output status delay
  while [ "$attempt" -le "$R2_UPLOAD_MAX_ATTEMPTS" ]; do
    output="$("$@" 2>&1)" && status=0 || status=$?
    if [ "$status" -eq 0 ]; then
      if [ "$attempt" -gt 1 ]; then
        echo "    uploaded after ${attempt} attempts: ${label}"
      fi
      return 0
    fi

    if is_permanent_upload_error "$status" "$output"; then
      echo "::error::Permanent upload failure for ${label} (attempt ${attempt}/${R2_UPLOAD_MAX_ATTEMPTS})" >&2
      printf '%s\n' "$output" >&2
      return "$status"
    fi

    if ! is_transient_upload_error "$status" "$output"; then
      echo "::error::Non-retryable upload failure for ${label} (attempt ${attempt}/${R2_UPLOAD_MAX_ATTEMPTS})" >&2
      printf '%s\n' "$output" >&2
      return "$status"
    fi

    if [ "$attempt" -eq "$R2_UPLOAD_MAX_ATTEMPTS" ]; then
      echo "::error::Upload failed after ${attempt} transient attempts for ${label}" >&2
      printf '%s\n' "$output" >&2
      return "$status"
    fi

    delay="$(retry_delay_for_attempt "$attempt")"
    echo "::warning::Transient upload failure for ${label} (attempt ${attempt}/${R2_UPLOAD_MAX_ATTEMPTS}); retrying in ${delay}s" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
}

echo "=== Cloudflare R2 Upload ==="
echo "Version: ${VERSION}"
echo "Bucket:  ${R2_BUCKET}"
echo "URL:     ${R2_PUBLIC_URL}"
echo "Mode:    ${DRY_RUN}"
echo ""

# ── Generate latest.json with R2 URLs ────────────────────────────────
echo "Generating latest.json..."
node -e "
const fs = require('fs');
const version = process.env.VERSION;
const baseUrl = process.env.R2_PUBLIC_URL + '/releases/v' + version;
const dir = process.env.RELEASE_DIR;
const files = fs.readdirSync(dir);

const platforms = {};

// Detect arch from DMG filenames (always include arch, e.g. neumar_26.4.12_aarch64.dmg)
const dmgArch = files.find(f => f.endsWith('.dmg') && f.includes('aarch64')) ? 'aarch64'
  : files.find(f => f.endsWith('.dmg') && (f.includes('x64') || f.includes('x86_64'))) ? 'x64'
  : '';

// macOS ARM64
const macArmTar = files.find(f => f.includes('aarch64') && f.endsWith('.app.tar.gz'));
const macArmSig = files.find(f => f.includes('aarch64') && f.endsWith('.app.tar.gz.sig'));
if (macArmTar && macArmSig) {
  platforms['darwin-aarch64'] = {
    url: baseUrl + '/' + macArmTar,
    signature: fs.readFileSync(dir + '/' + macArmSig, 'utf-8').trim()
  };
}

// macOS Intel
const macIntelTar = files.find(f => f.includes('x64') && f.endsWith('.app.tar.gz'));
const macIntelSig = files.find(f => f.includes('x64') && f.endsWith('.app.tar.gz.sig'));
if (macIntelTar && macIntelSig) {
  platforms['darwin-x86_64'] = {
    url: baseUrl + '/' + macIntelTar,
    signature: fs.readFileSync(dir + '/' + macIntelSig, 'utf-8').trim()
  };
}

// Single-arch fallback: if no arch-specific bundles found but generic ones exist,
// use the DMG arch to assign them (e.g. Neumar.app.tar.gz → darwin-aarch64)
if (!platforms['darwin-aarch64'] && !platforms['darwin-x86_64'] && dmgArch) {
  const tar = files.find(f => f.endsWith('.app.tar.gz'));
  const sig = files.find(f => f.endsWith('.app.tar.gz.sig'));
  if (tar && sig) {
    const platform = dmgArch === 'aarch64' ? 'darwin-aarch64' : 'darwin-x86_64';
    platforms[platform] = {
      url: baseUrl + '/' + tar,
      signature: fs.readFileSync(dir + '/' + sig, 'utf-8').trim()
    };
  }
}

// Windows
const winZip = files.find(f => f.endsWith('.nsis.zip'));
const winSig = files.find(f => f.endsWith('.nsis.zip.sig'));
if (winZip && winSig) {
  platforms['windows-x86_64'] = {
    url: baseUrl + '/' + winZip,
    signature: fs.readFileSync(dir + '/' + winSig, 'utf-8').trim()
  };
}

// Linux
const linuxAppImage = files.find(f => f.endsWith('.AppImage.tar.gz'));
const linuxAppImageSig = files.find(f => f.endsWith('.AppImage.tar.gz.sig'));
if (linuxAppImage && linuxAppImageSig) {
  platforms['linux-x86_64'] = {
    url: baseUrl + '/' + linuxAppImage,
    signature: fs.readFileSync(dir + '/' + linuxAppImageSig, 'utf-8').trim()
  };
}

if (Object.keys(platforms).length === 0) {
  console.log('No updater artifacts found — latest.json will have no platform binaries');
}

const latest = {
  version: 'v' + version,
  notes: 'See release notes at ${R2_PUBLIC_URL}',
  pub_date: new Date().toISOString(),
  platforms
};

fs.writeFileSync(dir + '/latest.json', JSON.stringify(latest, null, 2));
console.log('Generated latest.json with platforms:', Object.keys(platforms).join(', '));
"

# ── Validate latest.json ─────────────────────────────────────────────
echo "Validating latest.json..."
node -e "
const j = JSON.parse(require('fs').readFileSync('${RELEASE_DIR}/latest.json', 'utf-8'));
const p = Object.entries(j.platforms);
for (const [k, v] of p) {
  if (!v.url || !v.signature) throw new Error('Missing url/sig for ' + k);
  if (!v.url.startsWith('https://')) throw new Error('Non-HTTPS url for ' + k);
}
if (!j.version.match(/^v[0-9]+\.[0-9]+\.[0-9]+$/)) throw new Error('Bad version: ' + j.version);
console.log('Validation passed:', p.length, 'platform(s)');
"

# ── Upload versioned release artifacts to releases/v{version}/ ────────
echo ""
echo "Uploading release artifacts to releases/v${VERSION}/..."
for ext in \
  ".app.tar.gz" ".app.tar.gz.sig" \
  ".nsis.zip" ".nsis.zip.sig" \
  ".AppImage.tar.gz" ".AppImage.tar.gz.sig" \
  ".dmg" ".exe" ".msi" ".AppImage" ".deb" ".rpm"; do
  for f in "${RELEASE_DIR}"/*"${ext}"; do
    [ -f "$f" ] || continue
    filename=$(basename "$f")
    echo "  ${filename}"
    upload_s3 "releases/v${VERSION}/${filename}" \
      aws s3 cp "$f" "s3://${R2_BUCKET}/releases/v${VERSION}/${filename}" \
      --endpoint-url "$R2_ENDPOINT" \
      --cache-control "public, max-age=31536000, immutable" \
      --quiet
  done
done

# ── Upload installers (stable names for website download links) ──────
echo ""
echo "Uploading installers to installer/..."

# Map versioned filenames to stable download names with arch suffix.
# When only one arch exists for a type, also upload without the suffix
# for backward compatibility (e.g. neumar.dmg).
# Stable public URLs that get overwritten — collected for the cache purge below.
PURGE_URLS=()

# Short cache window (60s) with mandatory revalidation. The stable URL pattern
# (installer/neumar.dmg) is overwritten in place every release, so we can't use
# a long max-age — browsers would serve stale local copies after a release and
# Cloudflare's purge can't reach the browser cache. 60s is short enough that
# the staleness window is bounded; `must-revalidate` ensures expired entries
# aren't served while a new copy is being fetched. With the ETag R2 returns,
# revalidation is a tiny If-None-Match → 304 round-trip (no body) when bytes
# haven't changed.
upload_installer() {
  local file="$1" stable_name="$2"
  echo "  $(basename "$file") → ${stable_name}"
  upload_s3 "installer/${stable_name}" \
    aws s3 cp "$file" "s3://${R2_BUCKET}/installer/${stable_name}" \
    --endpoint-url "$R2_ENDPOINT" \
    --cache-control "public, max-age=60, must-revalidate" \
    --quiet
  PURGE_URLS+=("${R2_PUBLIC_URL}/installer/${stable_name}")
}

# Upload installers with stable names. When only one arch exists for a type,
# use the plain name (e.g. neumar.dmg). Only add arch suffix when multiple
# architectures exist for the same type (e.g. neumar-arm64.dmg, neumar-x64.dmg).
upload_typed_installers() {
  local ext="$1" base="$2"
  local count=0
  local -a found_files=()
  for f in "${RELEASE_DIR}"/*"${ext}"; do
    [ -f "$f" ] || continue
    found_files+=("$f")
    count=$((count + 1))
  done
  if [ "$count" -eq 1 ]; then
    # Single arch: use plain name only
    upload_installer "${found_files[0]}" "${base}${ext}"
  elif [ "$count" -gt 1 ]; then
    # Multiple arches: use arch-suffixed names
    for f in "${found_files[@]}"; do
      local filename=$(basename "$f")
      local arch_suffix=""
      if [[ "$filename" == *aarch64* || "$filename" == *arm64* ]]; then
        arch_suffix="-arm64"
      elif [[ "$filename" == *x64* || "$filename" == *x86_64* ]]; then
        arch_suffix="-x64"
      fi
      upload_installer "$f" "${base}${arch_suffix}${ext}"
    done
  fi
}

upload_typed_installers ".dmg" "neumar"
upload_typed_installers ".exe" "neumar-setup"
upload_typed_installers ".msi" "neumar"
upload_typed_installers ".AppImage" "neumar"
upload_typed_installers ".deb" "neumar"
upload_typed_installers ".rpm" "neumar"

# ── Upload latest.json ────────────────────────────────────────────────
echo ""
echo "Uploading latest.json..."
# Same 60s revalidation window as installers — Tauri auto-updaters poll this
# manifest periodically and we want them to pick up new releases quickly
# without hammering the origin on every check.
upload_s3 "latest.json" \
  aws s3 cp "${RELEASE_DIR}/latest.json" "s3://${R2_BUCKET}/latest.json" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" \
  --cache-control "public, max-age=60, must-revalidate" \
  --quiet
PURGE_URLS+=("${R2_PUBLIC_URL}/latest.json")

# Keep versioned copy for audit trail
upload_s3 "releases/v${VERSION}/latest.json" \
  aws s3 cp "${RELEASE_DIR}/latest.json" "s3://${R2_BUCKET}/releases/v${VERSION}/latest.json" \
  --endpoint-url "$R2_ENDPOINT" \
  --content-type "application/json" \
  --cache-control "public, max-age=31536000, immutable" \
  --quiet

# ── Purge Cloudflare CDN cache for stable URLs ───────────────────────
# Stable URLs (installer/*, latest.json) point at the new bytes in R2 but
# any cache between R2 and the user (Cloudflare's edge, transparent ISP
# proxies, intermediate CDNs) can keep old copies until their max-age expires
# (60s; see the upload_installer / latest.json upload steps). The Cache-Control
# header alone bounds the staleness window, but we additionally purge the edge
# explicitly so the very next request to cdn.neumar.app fetches the fresh
# object without waiting out the 60s revalidation.
#
# Versioned URLs (releases/v{ver}/*) don't need purging — the path itself is
# new on each release and never collides with a cached entry.
#
# Docs: https://developers.cloudflare.com/api/resources/cache/methods/purge/
# Limits: 100 URLs per API call, 5 req/min on Free, token needs
# `Zone.Cache Purge: Purge` scoped to the zone.
if [ "$DRY_RUN" = "true" ]; then
  echo ""
  echo "Dry run complete — skipping CDN purge."
elif [ "${#PURGE_URLS[@]}" -eq 0 ]; then
  : # nothing to purge
elif [ -z "${CF_API_TOKEN:-}" ] || [ -z "${CF_ZONE_ID:-}" ]; then
  echo ""
  echo "::notice::CF_API_TOKEN/CF_ZONE_ID not set — skipping CDN purge."
  echo "Stable URLs may serve cached copies until max-age expires:"
  for url in "${PURGE_URLS[@]}"; do echo "  $url"; done
elif ! command -v jq >/dev/null 2>&1; then
  echo ""
  echo "::warning::jq not found — skipping CDN purge."
elif [[ ! "${CF_ZONE_ID}" =~ ^[a-f0-9]{32}$ ]]; then
  # Cloudflare zone IDs are always 32-char lowercase hex. A misconfigured
  # secret with `/`, `?`, or `#` would silently construct a malformed URL
  # hitting an unintended endpoint — refuse to interpolate it.
  echo ""
  echo "::warning::CF_ZONE_ID is not a valid 32-char hex zone ID — skipping purge."
else
  echo ""
  echo "Purging ${#PURGE_URLS[@]} URLs from Cloudflare cache..."

  # Build the JSON {"files":[...]} body via jq so URLs are escaped correctly.
  body=$(printf '%s\n' "${PURGE_URLS[@]}" | jq -R . | jq -s '{files: .}')

  # Use mktemp so concurrent runs on the same runner can't race on a shared
  # path. trap cleans up on any exit (success, failure, or interrupt).
  purge_tmp=$(mktemp)
  trap 'rm -f "$purge_tmp"' EXIT

  status=$(curl -sS -o "$purge_tmp" -w "%{http_code}" -X POST \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$body")

  if [ "$status" = "200" ] && [ "$(jq -r '.success' "$purge_tmp")" = "true" ]; then
    echo "  ✓ Purged successfully"
    for url in "${PURGE_URLS[@]}"; do echo "    $url"; done
  else
    echo "::warning::Cloudflare purge failed (HTTP $status)"
    cat "$purge_tmp"
    # Don't fail the release on purge errors — the upload itself succeeded.
  fi
fi

echo ""
echo "=== Upload complete ==="
echo "Update manifest: ${R2_PUBLIC_URL}/latest.json"
echo "Versioned copy:  ${R2_PUBLIC_URL}/releases/v${VERSION}/latest.json"
