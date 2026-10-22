#!/usr/bin/env bash
#
# Start BOTH processes in one container:
#
#   * gunicorn            — the Django HTTP API (the process Render monitors)
#   * runscanworker       — the background scan worker, restarted if it dies
#
# Why a script?  Free hosting plans (Render's free tier, for example) do not
# offer the paid "Background Worker" service type, and a start command
# replaces the Procfile.  Running the worker as a child of this script keeps
# the API and the worker in the SAME container, which also means they share
# the same filesystem: the worker can read the archives the API stored.
#
# Usage:  bash scripts/start_with_worker.sh
#
# Tunables (environment variables):
#   PORT, GUNICORN_WORKERS, GUNICORN_THREADS, GUNICORN_TIMEOUT,
#   SCAN_WORKER_POLL_INTERVAL
#
# GUNICORN_TIMEOUT defaults to 300 s on purpose: a request can spend up to
# CODEGUARD_AI_TIMEOUT (180 s) waiting for an AI provider, up to
# CODEGUARD_GITHUB_TIMEOUT (120 s) downloading a repository, and a large ZIP
# upload can take minutes on a 0.1 vCPU free instance.

set -uo pipefail

# ── Scanner binaries installed at build time ─────────────────────────────────
# install_gitleaks.sh drops gitleaks into backend/.tools/bin.  The build and
# the runtime share the same filesystem, but that directory is not on PATH by
# default — put it there and export CODEGUARD_GITLEAKS_BIN (the scanner checks
# that override first) so BOTH the API (availability endpoint) and the scan
# worker resolve the binary.  Exported vars are inherited by the child
# processes started below.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TOOLS_BIN="${BACKEND_DIR}/.tools/bin"
if [ -d "${TOOLS_BIN}" ]; then
  export PATH="${TOOLS_BIN}:${PATH}"
  if [ -z "${CODEGUARD_GITLEAKS_BIN:-}" ] && [ -x "${TOOLS_BIN}/gitleaks" ]; then
    export CODEGUARD_GITLEAKS_BIN="${TOOLS_BIN}/gitleaks"
  fi
  echo "[codeguard] tools directory on PATH: ${TOOLS_BIN}"
fi

POLL_INTERVAL="${SCAN_WORKER_POLL_INTERVAL:-2}"
HTTP_TIMEOUT="${GUNICORN_TIMEOUT:-300}"

web_pid=""
worker_pid=""

start_worker() {
  echo "[codeguard] scan worker starting (poll interval ${POLL_INTERVAL}s)"
  while true; do
    python manage.py runscanworker --poll-interval "${POLL_INTERVAL}"
    code=$?
    echo "[codeguard] scan worker exited with code ${code}; restarting in 5s"
    sleep 5
  done
}

shutdown() {
  # Ignore further signals so the teardown below is not interrupted.
  trap '' TERM INT

  echo "[codeguard] shutdown requested — stopping API and scan worker"
  if [ -n "${web_pid}" ]; then
    kill -TERM "${web_pid}" 2>/dev/null || true
  fi
  if [ -n "${worker_pid}" ]; then
    # Stop the running `manage.py runscanworker` first (the loop subshell
    # would otherwise restart it), then the loop itself.  An interrupted job
    # is requeued automatically by the worker's startup recovery.
    pkill -TERM -P "${worker_pid}" 2>/dev/null || true
    kill -TERM "${worker_pid}" 2>/dev/null || true
  fi

  wait 2>/dev/null
  echo "[codeguard] stopped"
  exit 0
}

trap shutdown TERM INT

# ── Scan worker ──────────────────────────────────────────────────────────────
start_worker &
worker_pid=$!

# ── HTTP API (foreground monitor) ────────────────────────────────────────────
gunicorn backend.wsgi:application \
  --bind "0.0.0.0:${PORT:-8000}" \
  --workers "${GUNICORN_WORKERS:-1}" \
  --threads "${GUNICORN_THREADS:-4}" \
  --timeout "${HTTP_TIMEOUT}" \
  --access-logfile - \
  --error-logfile - &
web_pid=$!

echo "[codeguard] API listening on port ${PORT:-8000} (gunicorn pid ${web_pid})"

# Block until either process exits.  If gunicorn dies, tear everything down so
# the hosting platform restarts the service as a whole.
wait -n 2>/dev/null || wait
shutdown
