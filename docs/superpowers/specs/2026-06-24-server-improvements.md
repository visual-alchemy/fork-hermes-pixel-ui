# Server Improvements — SQLite, CI, TypeScript

**Date:** 2026-06-24
**Status:** approved

## A. SQLite Agent Storage

Replace flat-file `/data/agents.json` with SQLite `/data/agents.db`.

### Problem
Agent state lives in container without volume mount. Container recreate = all agents vanish. Persisting agent state lets the dashboard survive restarts.

### Design

New file `backend/db.py`:

```python
class AgentStore:
    def __init__(self, db_path="/data/agents.db")
    async def init(self)           # CREATE TABLE IF NOT EXISTS
    async def upsert_agent(data)   # INSERT OR REPLACE
    async def get_all_agents()     # SELECT all active
    async def delete_agent(id)     # DELETE by id
    async def prune_stale(hours)   # DELETE old agents
```

Schema:
```sql
CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT,
    status TEXT,
    location TEXT,
    task TEXT,
    activity TEXT,
    last_update TEXT,
    replay BOOLEAN,
    replay_tool TEXT,
    extra TEXT  -- JSON blob for future fields
);
```

`server.py` changes:
- `AgentState.__init__` → `await db.init()` + load existing agents
- `AgentState._save_to_file` → `await db.upsert_agent(agent)`
- `AgentState.get_all_agents` → `await db.get_all_agents()`
- `AgentState.remove_agent` → `await db.delete_agent(id)`
- In-memory dict stays for WebSocket broadcast speed

`docker-compose.yml` — add volume:
```yaml
volumes:
  - ./data:/data
```

`backend/requirements.txt` — add `aiosqlite`.

### Non-goals
- Presets stay as JSON files (already persist via `./backend/presets` volume)
- Terminal logs stay in-memory (ephemeral UI state)
- No migration of existing agents.json (fresh start on deploy)

---

## B. CI via GitHub Actions

### Problem
Every deploy is manual verification. No automated check that Docker builds, tests pass, or types are clean.

### Design

`.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
        working-directory: frontend
      - run: npm run typecheck
        working-directory: frontend
      - run: npm run test
        working-directory: frontend

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose build
```

Two jobs: `frontend` (tsc + vitest) and `docker` (verify build). Both run in parallel.

---

## C. TypeScript Strict Mode

### Problem
`OfficeRenderer.ts` has `noImplicitAny: false`. ~30 methods lack parameter types. The `hoverTile` null crash would have been caught with strict types.

### Design

**types.ts** — add missing fields:
- `AgentState`: `isMoving`, `zoneId`, `slotIndex`, `activity`, `roamStep`, `roamMode`, `nextRoamAt`
- Export `Door` type

**OfficeRenderer.ts** — add type annotations (~30 methods):
- `drawRoom(zone: Zone)`, `drawOpenZone(zone: Zone)`, `drawZoneLabel(zone: Zone)`
- `collectRenderables(agents: Agent[]): RenderableEntry[]`
- `getAgentZone(agent: Agent): Zone | null`
- `getAgentActivity(agent: Agent): string`
- `getFurniturePlacement(item: FurnitureItem, sprite): PlacementResult`
- `resolveFurnitureSprite(asset, item): FurnitureSprite | null`
- All wall-drawing helpers
- Internal arrays: `segments: Array<{x: number, width: number}>`, `RenderableEntry[]`

**tsconfig.json** — remove `"noImplicitAny": false`.

Zero logic changes. Pure type annotations.

---

## Self-Review

- No placeholders or TBDs
- Three changes are independent — can ship in any order
- SQLite change: add `aiosqlite` dep, new `db.py`, modify 4 methods in `server.py`, one YAML line
- CI: one new file, no code changes
- TS: ~40 lines of type annotations across 2 files
