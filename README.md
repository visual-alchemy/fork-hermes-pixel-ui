# Hermes Pixel UI

A pixel-art operations room for **Hermes Agent** sessions.

Hermes Pixel UI turns local Hermes activity into animated agents inside a small office: coding work happens at desks, document work moves to the archive, planning goes to the meeting room, waiting happens at the brew bar, and completed work moves to recharge.

The app is designed as a local companion UI for Hermes Agent. It does not replace Hermes, does not modify Hermes core, and can run entirely on `localhost`.

## Features

- Live visualization of Hermes sessions as pixel characters.
- WebSocket updates between the FastAPI backend and the React frontend.
- Optional Hermes plugin event ingestion through `POST /api/hermes-event`.
- Fallback polling for Hermes session files in `~/.hermes/sessions`.
- Room-based activity mapping for coding, browsing, file work, planning, waiting, and completion.
- Editable scene layout with drag-and-drop furniture placement.
- Local layout persistence in browser storage.
- Automatic cleanup of completed agents so long sessions do not clutter the office.

## How It Works

Hermes Pixel UI uses the Hermes `session_id` as the visual agent identifier.

There are two supported input paths:

1. **Live plugin events**
   Hermes sends lifecycle events to the Pixel UI backend:

   ```text
   Hermes Agent -> pixel-ui-bridge plugin -> POST /api/hermes-event -> WebSocket -> browser
   ```

2. **Session file fallback**
   If the plugin is not installed or not active, the backend polls Hermes session files:

   ```text
   ~/.hermes/sessions/session_*.json
   ~/.hermes/sessions/*.jsonl
   ```

When live plugin events are active for a session, file polling stays as a fallback but does not overwrite recent live state.

## Rooms

| Room | Hermes Activity |
| --- | --- |
| `Main Floor` | Terminal work, browser work, code edits, patches, command execution |
| `Archive` | File reads, search, memory, documents, notes, mail-like/document workflows |
| `Meeting Room` | LLM thinking, planning, brainstorming, design, coordination |
| `Brew Bar` | Waiting, clarification, idle state, pauses |
| `Recharge` | Completed tasks and short rest state |

The mapping is heuristic and lives in [backend/server.py](backend/server.py).

## Requirements

- Python 3.9+
- Node.js 18+
- npm
- Hermes Agent installed locally

Python dependencies are listed in [backend/requirements.txt](backend/requirements.txt). Frontend dependencies are listed in [frontend/package.json](frontend/package.json).

## Quick Start

From the repository root:

```bash
./start.sh
```

This starts:

- Backend API on `http://localhost:9000`
- Vite development frontend on `http://localhost:9001`

Open:

```text
http://localhost:9001
```

## Production-Style Local Run

Build the frontend first:

```bash
cd frontend
npm install
npm run build
```

Then start the backend:

```bash
cd ../backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

Open:

```text
http://localhost:9000
```

In this mode, FastAPI serves the compiled frontend from `frontend/dist`.

## Hermes Plugin Setup

For live updates, Hermes should have the `pixel-ui-bridge` plugin installed under:

```text
~/.hermes/plugins/pixel-ui-bridge/
```

Hermes must also enable the plugin in its configuration:

```yaml
plugins:
  enabled:
    - pixel-ui-bridge
```

The plugin is expected to send local HTTP events to:

```text
http://localhost:9000/api/hermes-event
```

If the plugin is not available, Pixel UI still works through session-file polling.

## API

Useful local endpoints:

```bash
curl http://localhost:9000/api/status
curl http://localhost:9000/api/agents
```

Manual event probe:

```bash
curl -X POST http://localhost:9000/api/hermes-event \
  -H "Content-Type: application/json" \
  -d '{"event":"tool_start","tool_name":"probe","session_id":"demo"}'
```

WebSocket endpoint:

```text
ws://localhost:9000/ws
```

## Development

Frontend hot reload:

```bash
cd frontend
npm install
npm run dev
```

Backend:

```bash
cd backend
source .venv/bin/activate
python server.py
```

After frontend source changes, rebuild if you want the backend to serve the latest compiled app:

```bash
cd frontend
npm run build
```

Backend changes require restarting `python server.py`.

## Diagnostics

Run the safe plugin/backend check:

```bash
./check-plugin.sh
```

The script checks plugin presence and backend reachability without printing local Hermes files, source code, git history, or user-specific absolute paths.

## Project Structure

```text
backend/
  server.py          FastAPI app, WebSocket state, Hermes event mapping
  hermes_bridge.py   Hermes session polling and fallback bridge
  requirements.txt   Python dependencies

frontend/
  src/App.jsx        React shell, panels, editor controls
  src/game/          Pixel renderer, layout logic, sprite handling
  package.json       Frontend dependencies and scripts

layouts/
  default.json       Base office layout

check-plugin.sh      Safe local diagnostics
start.sh             Local development launcher
```

## Privacy and GitHub Safety

This repository is intended to be safe to publish.

The `.gitignore` excludes local-only files such as:

- virtual environments
- `node_modules`
- build output
- logs
- `.env` files
- local databases
- Python caches
- OS metadata files

Before publishing, use Git rather than uploading a raw ZIP of the whole folder. A raw ZIP may include ignored local files such as `.venv`, `node_modules`, `.DS_Store`, or generated builds.

## Limitations

- Visual separation depends on Hermes creating distinct session IDs.
- Room assignment is heuristic and depends on the event or tool metadata Hermes emits.
- Live updates depend on the Hermes plugin being installed and enabled.
- Without live plugin events, updates come from session-file polling and may be less immediate.

## License

Add a license before publishing if this repository is meant to be reused by others.
