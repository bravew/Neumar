#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/r2-upload.sh"

make_release_dir() {
  local dir="$1"
  printf 'bundle' >"${dir}/Neumar_aarch64.app.tar.gz"
  printf 'signature' >"${dir}/Neumar_aarch64.app.tar.gz.sig"
  printf 'installer' >"${dir}/neumar_26.0.0_aarch64.dmg"
}

run_with_stubbed_aws() {
  local mode="$1"
  local work_dir="$2"
  local bin_dir="${work_dir}/bin"
  local count_file="${work_dir}/aws-count"
  mkdir -p "$bin_dir"
  cat >"${bin_dir}/aws" <<'AWS'
#!/bin/bash
set -euo pipefail
count_file="${AWS_STUB_COUNT_FILE:?}"
count=0
if [ -f "$count_file" ]; then
  count=$(cat "$count_file")
fi
count=$((count + 1))
printf '%s' "$count" >"$count_file"
case "${AWS_STUB_MODE:?}" in
  transient)
    if [ "$count" -eq 1 ]; then
      echo "upload failed: ECONNRESET" >&2
      exit 255
    fi
    exit 0
    ;;
  permanent)
    echo "An error occurred (AccessDenied) when calling the PutObject operation" >&2
    exit 1
    ;;
  fail-if-called)
    echo "aws should not be called" >&2
    exit 99
    ;;
  *)
    exit 0
    ;;
esac
AWS
  chmod +x "${bin_dir}/aws"
  cat >"${bin_dir}/sleep" <<'SLEEP'
#!/bin/bash
exit 0
SLEEP
  chmod +x "${bin_dir}/sleep"

  PATH="${bin_dir}:$PATH" \
    AWS_STUB_MODE="$mode" \
    AWS_STUB_COUNT_FILE="$count_file" \
    VERSION="26.0.0" \
    RELEASE_DIR="${work_dir}/release" \
    R2_BUCKET="test-bucket" \
    R2_PUBLIC_URL="https://cdn.example.test" \
    CF_ACCOUNT_ID="0123456789abcdef0123456789abcdef" \
    CF_R2_ACCESS_KEY_ID="access" \
    CF_R2_SECRET_ACCESS_KEY="secret" \
    R2_UPLOAD_BASE_DELAY=0 \
    R2_UPLOAD_MAX_DELAY=0 \
    bash "$SCRIPT"
}

test_transient_retry_succeeds() {
  local work_dir
  work_dir=$(mktemp -d)
  mkdir -p "${work_dir}/release"
  make_release_dir "${work_dir}/release"

  run_with_stubbed_aws transient "$work_dir" >/tmp/r2-transient.out 2>&1
  local count
  count=$(cat "${work_dir}/aws-count")
  if [ "$count" -lt 2 ]; then
    echo "expected transient upload to retry, got ${count} call(s)" >&2
    cat /tmp/r2-transient.out >&2
    exit 1
  fi
}

test_permanent_failure_fast_fails() {
  local work_dir
  work_dir=$(mktemp -d)
  mkdir -p "${work_dir}/release"
  make_release_dir "${work_dir}/release"

  if run_with_stubbed_aws permanent "$work_dir" >/tmp/r2-permanent.out 2>&1; then
    echo "expected permanent upload failure" >&2
    exit 1
  fi
  local count
  count=$(cat "${work_dir}/aws-count")
  if [ "$count" -ne 1 ]; then
    echo "expected permanent failure to stop after 1 call, got ${count}" >&2
    cat /tmp/r2-permanent.out >&2
    exit 1
  fi
}

test_dry_run_skips_aws() {
  local work_dir
  work_dir=$(mktemp -d)
  mkdir -p "${work_dir}/release"
  make_release_dir "${work_dir}/release"

  local bin_dir="${work_dir}/bin"
  mkdir -p "$bin_dir"
  cat >"${bin_dir}/aws" <<'AWS'
#!/bin/bash
echo "aws should not be called" >&2
exit 99
AWS
  chmod +x "${bin_dir}/aws"

  PATH="${bin_dir}:$PATH" \
    DRY_RUN=true \
    VERSION="26.0.0" \
    RELEASE_DIR="${work_dir}/release" \
    R2_BUCKET="test-bucket" \
    R2_PUBLIC_URL="https://cdn.example.test" \
    bash "$SCRIPT" >/tmp/r2-dry-run.out 2>&1

  grep -q "Dry run complete" /tmp/r2-dry-run.out
  grep -q "dry-run: releases/v26.0.0/neumar_26.0.0_aarch64.dmg" /tmp/r2-dry-run.out
  grep -q "dry-run: installer/neumar.dmg" /tmp/r2-dry-run.out
}

test_transient_retry_succeeds
test_permanent_failure_fast_fails
test_dry_run_skips_aws

echo "r2-upload tests passed"
