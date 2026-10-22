#!/usr/bin/env bash
#
# Install the gitleaks binary (secret scanner) on a Linux host.
#
# gitleaks is distributed as a static binary — there is no pip package.  This
# script downloads the latest release from GitHub and drops the executable
# into /usr/local/bin so it is on PATH for the scan worker.
#
# Usage:  bash scripts/install_gitleaks.sh
#
# It is called from the build command of the Render blueprint:
#   backend/buildCommand: bash scripts/install_gitleaks.sh && pip install ...
#
# If the GitHub API cannot be reached (rate limit, no network) the script
# falls back to a pinned, known-good release.

set -euo pipefail

FALLBACK_VERSION="8.28.0"

# Prefer a directory that is on PATH; fall back to a user-writable one.
# (The build and the runtime share the same filesystem on native runtimes, so
# whatever we install here is still there when the worker starts.)
choose_install_dir() {
  local candidate="${GITLEAKS_INSTALL_DIR:-/usr/local/bin}"
  if mkdir -p "${candidate}" 2>/dev/null && [ -w "${candidate}" ]; then
    printf '%s' "${candidate}"
    return 0
  fi
  printf '%s' "${HOME}/.local/bin"
}
INSTALL_DIR="$(choose_install_dir)"
mkdir -p "${INSTALL_DIR}"

detect_latest_version() {
  curl -sSf --max-time 20 \
    https://api.github.com/repos/gitleaks/gitleaks/releases/latest 2>/dev/null \
    | grep -m1 '"tag_name"' \
    | cut -d'"' -f4 \
    | sed 's/^v//' || true
}

VERSION="$(detect_latest_version)"
if [ -z "${VERSION}" ]; then
  echo "gitleaks: could not query the latest release, using ${FALLBACK_VERSION}"
  VERSION="${FALLBACK_VERSION}"
else
  echo "gitleaks: installing latest release ${VERSION}"
fi

ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

if ! curl -sSfL --max-time 120 "${URL}" -o "${TMP_DIR}/${ARCHIVE}"; then
  echo "gitleaks: download failed, retrying with pinned ${FALLBACK_VERSION}"
  VERSION="${FALLBACK_VERSION}"
  ARCHIVE="gitleaks_${VERSION}_linux_x64.tar.gz"
  URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ARCHIVE}"
  curl -sSfL --max-time 120 "${URL}" -o "${TMP_DIR}/${ARCHIVE}"
fi

tar -xzf "${TMP_DIR}/${ARCHIVE}" -C "${TMP_DIR}" gitleaks
mv "${TMP_DIR}/gitleaks" "${INSTALL_DIR}/gitleaks"
chmod +x "${INSTALL_DIR}/gitleaks"

echo "gitleaks: installed $("${INSTALL_DIR}/gitleaks" version 2>/dev/null | head -n1) -> ${INSTALL_DIR}/gitleaks"
