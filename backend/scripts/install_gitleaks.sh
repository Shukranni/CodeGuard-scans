#!/usr/bin/env bash
#
# Install the gitleaks binary (secret scanner) on a Linux host.
#
# gitleaks is distributed as a static binary — there is no pip package.  This
# script downloads the latest release from GitHub and drops the executable
# into backend/.tools/bin (project-relative, always writable).  The start
# script (start_with_worker.sh) puts that directory on PATH and exports
# CODEGUARD_GITLEAKS_BIN, so the API and the scan worker always find it.
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

# Install into a project-relative directory instead of guessing PATH entries.
# The previous logic tried /usr/local/bin first (often not writable for the
# build user) and fell back to $HOME/.local/bin (never on the runtime PATH) —
# so the install "succeeded" but the worker still reported
# "gitleaks executable not found".  backend/.tools/bin is always writable,
# ships with the deployed code, and start_with_worker.sh wires it into PATH.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
INSTALL_DIR="${GITLEAKS_INSTALL_DIR:-${BACKEND_DIR}/.tools/bin}"
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
