# React

A modern React-based project utilizing the latest frontend technologies and tools for building responsive web applications.

## 🚀 Features

- **React 18** - React version with improved rendering and concurrent features
- **Vite** - Lightning-fast build tool and development server
- **Redux Toolkit** - State management with simplified Redux setup
- **TailwindCSS** - Utility-first CSS framework with extensive customization
- **React Router v6** - Declarative routing for React applications
- **Data Visualization** - Integrated D3.js and Recharts for powerful data visualization
- **Form Management** - React Hook Form for efficient form handling
- **Animation** - Framer Motion for smooth UI animations
- **Testing** - Jest and React Testing Library setup

## 📋 Prerequisites

- Node.js (v14.x or higher)
- npm or yarn

## 🛠️ Installation

1. Install dependencies:
   ```bash
   npm install
   # or
   yarn install
   ```
   
2. Start the development server:
   ```bash
   npm start
   # or
   yarn start
   ```

## 📁 Project Structure

```
react_app/
├── public/             # Static assets
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Page components
│   ├── styles/         # Global styles and Tailwind configuration
│   ├── App.jsx         # Main application component
│   ├── Routes.jsx      # Application routes
│   └── index.jsx       # Application entry point
├── .env                # Environment variables
├── index.html          # HTML template
├── package.json        # Project dependencies and scripts
├── tailwind.config.js  # Tailwind CSS configuration
└── vite.config.js      # Vite configuration
```

## 🧩 Adding Routes

To add new routes to the application, update the `Routes.jsx` file:

```jsx
import { useRoutes } from "react-router-dom";
import HomePage from "pages/HomePage";
import AboutPage from "pages/AboutPage";

const ProjectRoutes = () => {
  let element = useRoutes([
    { path: "/", element: <HomePage /> },
    { path: "/about", element: <AboutPage /> },
    // Add more routes as needed
  ]);

  return element;
};
```

## 🎨 Styling

This project uses Tailwind CSS for styling. The configuration includes:

- Forms plugin for form styling
- Typography plugin for text styling
- Aspect ratio plugin for responsive elements
- Container queries for component-specific responsive design
- Fluid typography for responsive text
- Animation utilities

## 📱 Responsive Design

The app is built with responsive design using Tailwind CSS breakpoints.


## 📦 Deployment

Free hosting (Render + free Postgres) is fully configured — see
**[DEPLOYMENT.md](DEPLOYMENT.md)** for the step-by-step guide. In short:

```bash
git add -A && git commit -m "CodeGuard" && git push
# then: Render dashboard → New → Blueprint → select this repository
```

The blueprint ([`render.yaml`](render.yaml)) creates the API **and** the scan
worker (one container) plus a static site for the React app.

Build the application for production yourself:

```bash
npm run build        # output goes to ./build
```

## 🙏 Acknowledgments

- Powered by React and Vite
- Styled with Tailwind CSS

---

# Backend: running the security scan pipeline

Scans are created fast and executed **in the background** by a separate worker
process.

```bash
# Terminal 1 — HTTP API (this is all you need)
cd backend
python manage.py migrate
python manage.py runserver
```

**The worker starts itself.** When a scan is queued and no worker is running,
the API starts a detached `manage.py runscanworker` process (and restarts it
if it dies). You do not need a second terminal:

```
POST /api/scans/start/   ──▶  no worker?  ──▶  spawn manage.py runscanworker
```

Starting the worker by hand is still supported and useful for a long-lived
worker or for watching its output:

```bash
# Terminal 2 — optional: a worker you started yourself
cd backend
python manage.py runscanworker
```

Only one worker may run per machine. The worker holds an operating-system
lock for its whole lifetime (`scans/services/worker_slot.py`), so a second
worker exits immediately instead of competing for the queue. The lock is
released by the OS when the process dies, so a crashed worker never blocks a
restart.

If the worker cannot be started, scans stay in status `queued`. The API
reports this explicitly (`worker_online: false` on the status endpoint) and
the UI shows "Starting the scan worker" instead of an endless loading screen —
scans are never silently lost, they simply wait.

## Automatic worker start

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEGUARD_AUTOSTART_WORKER` | on in development, off in production | `1`/`true` always lets the API start a worker, `0`/`false` never does. |
| `CODEGUARD_WORKER_IDLE_TIMEOUT` | `600` | Seconds an auto-started worker stays alive without processing a scan before it shuts itself down (`0` = never). |
| `CODEGUARD_WORKER_LOG` | `backend/logs/scanworker.log` | Where the auto-started worker writes its output. |

Production deployments keep the dedicated worker (`scripts/start_with_worker.sh`
on Render) and leave `CODEGUARD_AUTOSTART_WORKER` unset.

## Scan lifecycle

```
queued ──▶ preparing ──▶ running ──▶ completed
                                      completed_with_warnings
                                      failed
```

| Status | Meaning |
| --- | --- |
| `queued` | Scan row created and waiting for a worker. `POST /api/scans/start/` returns this immediately. |
| `preparing` | A worker claimed the job (atomically) and is validating/extracting the archive. |
| `running` | Scanners are executing. `stage` is `running:<scanner>` for the scanner in flight. |
| `completed` | All selected scanners ran without execution errors. |
| `completed_with_warnings` | Some scanners failed to execute, others succeeded (or were skipped). Results are still available. |
| `failed` | Nothing usable was produced (bad archive, all scanners failed, or the job was lost). `error` explains why. |

`stage` and `progress` (0–100, derived from completed scanners) are exposed for
the UI; they are never fabricated. A scan in a terminal status never changes again.

## API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/projects/upload/` | Upload a ZIP archive and register it as a project owned by the authenticated user. |
| `POST` | `/api/projects/github/` | Download a GitHub repository, archive it and register it as a project. Returns **201** with the project id and the validation payload. |
| `GET` | `/api/projects/<id>/validate/` | Validate the stored archive (central-directory read, no extraction). |
| `GET` | `/api/projects/<id>/filetree/` | Hierarchical file listing of the stored archive. |
| `POST` | `/api/scans/start/` | Validate the archive (central-directory read, no extraction) and enqueue a scan. Returns **201** with `{id, status: "queued", stage, progress, ...}` in milliseconds. |
| `GET` | `/api/scans/<id>/status/` | Lightweight snapshot used for polling: `status`, `stage`, `progress`, `scanner_status`, `is_terminal`, `worker_online`, `error`. Owner-scoped; does **not** mutate anything. |
| `GET` | `/api/scans/scanners/` | Cached availability of `semgrep`, `gitleaks` and `npm audit`, each with an install `hint`. |
| `GET` | `/api/scans/` | Scan list (owner-scoped), includes lifecycle fields. |
| `GET` | `/api/scans/<id>/` | Full scan record including `result`. |

## Scanning a GitHub repository

`POST /api/projects/github/` accepts a repository URL and turns it into a
scannable project:

```json
{ "url": "https://github.com/owner/repository", "token": "ghp_…", "branch": "main" }
```

* The repository is downloaded, archived into a ZIP and stored exactly like an
  uploaded archive — validation, extraction and scanning stay on a single code
  path, so the response already carries the validation payload.
* `token` and `branch` are optional. The token is used for the download only:
  it is never written to the database, never logged and never returned.
* Only `github.com` repositories are accepted. The URL the user types is
  parsed into an owner and a repository name and the request URL is rebuilt
  from those, so the endpoint cannot be used to reach arbitrary hosts.
* `git` is used when it is available on `PATH`; otherwise the GitHub API
  tarball endpoint is used as a fallback.

| Variable | Default | Meaning |
| --- | --- | --- |
| `CODEGUARD_GITHUB_TIMEOUT` | `120` | Seconds a single `git clone` may take. |
| `CODEGUARD_GITHUB_DOWNLOAD_TIMEOUT` | `90` | Seconds the GitHub API tarball download may take. |

## Worker operations

```bash
python manage.py runscanworker                 # normal operation
python manage.py runscanworker --once          # process every queued scan, then exit (CI/cron)
python manage.py runscanworker --poll-interval 1
python manage.py runscanworker --idle-timeout 600   # exit after 10 idle minutes
```

The worker:

* claims jobs with a conditional `UPDATE status='queued' -> 'preparing'`, so two
  workers can never execute the same scan;
* holds an OS-level lock so only one worker runs per machine;
* writes a `WorkerHeartbeat` row every poll cycle (used for `worker_online`);
* persists partial results as each scanner finishes;
* requeues jobs left in `preparing`/`running` by a crashed worker on startup;
* fails scans whose heartbeat is older than the stale timeout, so nothing waits
  forever;
* cleans up its extraction directory in a `finally` block.

### Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `SCAN_WORKER_POLL_INTERVAL` | `2` | Seconds between queue polls. |
| `SCAN_STALE_TIMEOUT` | `1800` | Seconds without a scan heartbeat before a scan is considered interrupted. Must exceed the per-scanner timeout. |
| `SCAN_WORKER_HEARTBEAT_TIMEOUT` | `30` | Seconds before a worker heartbeat counts as offline. |
| `SCAN_WORKER_IDLE_TIMEOUT` | `0` | Seconds an idle worker keeps running (`0` = forever). The auto-started worker overrides this with `--idle-timeout`. |
| `CODEGUARD_AUTOSTART_WORKER` | on in development | Whether the API may start a worker by itself. |
| `CODEGUARD_WORKER_IDLE_TIMEOUT` | `600` | Idle timeout of an auto-started worker. |
| `CODEGUARD_WORKER_LOG` | `backend/logs/scanworker.log` | Log file of the auto-started worker. |
| `CODEGUARD_SEMGREP_BIN` | *(auto)* | Explicit path to the `semgrep` executable when it is not on `PATH`. |
| `CODEGUARD_SEMGREP_CONFIG` | `p/default` | Semgrep rule set to run (any registry name, e.g. `p/security-audit`). |
| `CODEGUARD_SEMGREP_TIMEOUT` | `300` | Minimum number of seconds a Semgrep scan may take. |
| `CODEGUARD_SEMGREP_SECONDS_PER_FILE` | `1.5` | Extra seconds the Semgrep timeout allows per analysed file. |
| `CODEGUARD_SEMGREP_MAX_TIMEOUT` | `900` | Upper bound for the scaled Semgrep timeout. |
| `CODEGUARD_SEMGREP_JOBS` | *(auto)* | Semgrep worker processes. Auto-detected: one when memory is tight, two otherwise. |
| `CODEGUARD_SEMGREP_MAX_MEMORY` | `0` (no cap) | Memory cap in MiB passed to Semgrep's `--max-memory`. Small hosts (512 MB) set `192` so an oversized file is skipped instead of triggering the OOM killer. |
| `CODEGUARD_SEMGREP_RULES_DIR` | `backend/.semgrep_cache` | Where the downloaded Semgrep rule set is cached. |
| `CODEGUARD_SEMGREP_RULES_TTL` | `604800` | Seconds before the cached rule set is refreshed (7 days). |
| `CODEGUARD_SEMGREP_RULES_TIMEOUT` | `180` | Seconds allowed for downloading the rule set. |

### Semgrep performance

Semgrep downloads its rule set from `semgrep.dev` — about 2.5 MB for
`p/default` — and re-validates it against the registry on **every** scan. On a
slow connection that download regularly took longer than the scan itself, which
is why scans used to end with *"Some scanners could not complete: semgrep"*.

The worker now downloads the rule set **once** into `backend/.semgrep_cache/`
(never committed) and runs Semgrep against the local file. Scans therefore
start immediately, keep working when the network is down, and no longer lose
the whole timeout to a download. The cache is refreshed once a week and
re-downloaded on demand.

Analysing a project still costs roughly a second per file, so the Semgrep
timeout scales with the project size (300s + 1.5s per file, capped at 900s).

## Scanner prerequisites

| Scanner | Required | Install |
| --- | --- | --- |
| Semgrep | `semgrep` on `PATH` (or `CODEGUARD_SEMGREP_BIN`) | `pip install semgrep` |
| GitLeaks | `gitleaks` on `PATH` | https://github.com/gitleaks/gitleaks |
| npm audit | `npm` on `PATH` | Install Node.js |

Missing tools are reported as an execution error for that scanner — they never
hang the request. `GET /api/scans/scanners/` lists availability at any time.

## Archive safety

`inspect_zip` reads only the ZIP central directory (no extraction) and runs
inside the request cycle. `safe_extract_zip` applies zip-slip protection
(absolute paths, drive letters, `..` traversal) and a 500 MB decompressed
budget with a 100,000-entry cap. Unsafe archives are rejected with **400**
before any scan row is created.

## Tests

```bash
cd backend
python manage.py test            # lifecycle, queue claims, recovery, ZIP safety
```


