# Server Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add SQLite agent persistence, GitHub Actions CI, and TypeScript strict mode for OfficeRenderer.

**Architecture:** Three independent changes. SQLite: new `db.py` replaces file I/O in `server.py`. CI: one workflow file. TypeScript: add type annotations to ~30 untyped method params in OfficeRenderer.ts, remove `noImplicitAny`.

**Tech Stack:** Python 3.10+ / aiosqlite, GitHub Actions, TypeScript 5+, Vite 5.

---

## Task 1: SQLite — DB module

**Files:**
- Create: `backend/db.py`
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add aiosqlite to requirements**

```bash
echo "aiosqlite" >> backend/requirements.txt
```

- [ ] **Step 2: Create db.py**

Write `backend/db.py`:

```python
import aiosqlite
import json
import logging
from typing import Optional

logger = logging.getLogger(__name__)

class AgentStore:
    def __init__(self, db_path: str = "/data/agents.db"):
        self.db_path = db_path
        self._db: Optional[aiosqlite.Connection] = None

    async def init(self):
        self._db = await aiosqlite.connect(self.db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT DEFAULT '',
                status TEXT DEFAULT 'idle',
                location TEXT DEFAULT '',
                task TEXT DEFAULT '',
                activity TEXT DEFAULT '',
                last_update TEXT DEFAULT '',
                replay INTEGER DEFAULT 0,
                replay_tool TEXT DEFAULT '',
                extra TEXT DEFAULT '{}'
            )
        """)
        await self._db.commit()
        logger.info(f"Agent store ready at {self.db_path}")

    async def upsert_agent(self, agent: dict):
        await self._db.execute("""
            INSERT OR REPLACE INTO agents (id, name, status, location, task, activity, last_update, replay, replay_tool, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            agent.get("id", ""),
            agent.get("name", ""),
            agent.get("status", "idle"),
            agent.get("location", ""),
            agent.get("task", ""),
            agent.get("activity", ""),
            agent.get("last_update", ""),
            1 if agent.get("replay") else 0,
            agent.get("replay_tool", ""),
            json.dumps({k: v for k, v in agent.items() if k not in (
                "id", "name", "status", "location", "task", "activity",
                "last_update", "replay", "replay_tool"
            )}),
        ))
        await self._db.commit()

    async def get_all_agents(self) -> list[dict]:
        cursor = await self._db.execute("SELECT * FROM agents")
        rows = await cursor.fetchall()
        agents = []
        for row in rows:
            agent = dict(row)
            extra = json.loads(agent.pop("extra", "{}"))
            agent["replay"] = bool(agent.get("replay"))
            agent.update(extra)
            agents.append(agent)
        return agents

    async def delete_agent(self, agent_id: str):
        await self._db.execute("DELETE FROM agents WHERE id = ?", (agent_id,))
        await self._db.commit()

    async def prune_stale(self, hours: float = 1):
        from datetime import datetime, timedelta, timezone
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
        await self._db.execute("DELETE FROM agents WHERE last_update < ?", (cutoff,))
        await self._db.commit()

    async def close(self):
        if self._db:
            await self._db.close()
```

- [ ] **Step 3: Commit**

```bash
git add backend/db.py backend/requirements.txt
git commit -m "feat: add SQLite agent store module"
```

---

## Task 2: SQLite — Wire into server.py

**Files:**
- Modify: `backend/server.py`

- [ ] **Step 1: Replace AgentState file I/O with AgentStore**

Find the `AgentState` class in `backend/server.py`. Replace `AGENT_STATE_FILE` and file-based methods.

Remove line 47:
```python
AGENT_STATE_FILE = os.getenv("AGENT_STATE_FILE", "/data/agents.json")
```

Add at top of `AgentState.__init__`:
```python
from db import AgentStore
self.store = AgentStore()
```

Replace `_save_to_file` (full method):
```python
async def _save_to_file(self):
    # No-op — AgentStore handles persistence on each upsert
    pass
```

Replace `_load_from_file` (full method):
```python
async def _load_from_file(self):
    try:
        agents = await self.store.get_all_agents()
        for agent in agents:
            self.agents[agent["id"]] = agent
        logger.info(f"Loaded {len(agents)} agents from SQLite")
    except Exception as e:
        logger.warning(f"Could not load agents: {e}")
```

In `update_agent`, after `self.agents[agent_id] = agent_data`, add:
```python
import asyncio
asyncio.create_task(self.store.upsert_agent(agent_data))
```

In `remove_agent`, after `del self.agents[agent_id]`, add:
```python
asyncio.create_task(self.store.delete_agent(agent_id))
```

In `_prune_stale_agents`, replace file-based prune with:
```python
await self.store.prune_stale(STALE_AGENT_TTL_HOURS)
```

In the app startup (before `uvicorn.run`), add DB init:
```python
@app.on_event("startup")
async def startup():
    await state.store.init()
    await state._load_from_file()
```

- [ ] **Step 2: Update docker-compose.yml volume**

In `docker-compose.yml`, add the data volume:

```yaml
volumes:
  - ${HOME}/.hermes/sessions:/root/.hermes/sessions:ro
  - ./backend/presets:/app/backend/presets
  - ./data:/data
```

- [ ] **Step 3: Commit**

```bash
git add backend/server.py docker-compose.yml
git commit -m "feat: wire SQLite AgentStore into server, persist agents.db"
```

---

## Task 3: CI — GitHub Actions workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create workflow file**

```bash
mkdir -p .github/workflows
```

Write `.github/workflows/ci.yml`:

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
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker compose build
```

- [ ] **Step 2: Verify workflow syntax**

```bash
# Optional: install act and run locally
# brew install act
# act push --dryrun
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for typecheck, test, docker build"
```

---

## Task 4: TypeScript — Update types

**Files:**
- Modify: `frontend/src/types.ts`

- [ ] **Step 1: Add missing AgentState fields and Door export**

Edit `frontend/src/types.ts`. Ensure the `AgentState` interface has these optional fields:

```typescript
export interface AgentState {
  x: number
  y: number
  path: TilePos[]
  currentTarget: InteractionTarget | null
  finalTarget: InteractionTarget | null
  facingRight: boolean
  pose: string
  destinationZone?: string
  walkTimer: number
  idleTimer: number
  activityTimer: number
  animationFrame: number
  isMoving?: boolean
  zoneId?: string
  slotIndex?: number
  activity?: string
  roamStep?: number
  roamMode?: string
  nextRoamAt?: number
  breakFocus?: boolean
  deskFocus?: boolean
  meetingFocus?: boolean
  restFocus?: boolean
  meetingRole?: string
  movementIndex?: number
  targetPose?: string
  typingPulse?: number
  heightScale?: number
  status?: string
  activityStatus?: string
  scaleMultiplier?: number
  rotation?: number
  state?: string
}
```

Ensure `Door` is exported:

```typescript
export interface Door {
  side: 'left' | 'right' | 'top' | 'bottom'
  start: number
  size: number
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/types.ts
git commit -m "types: add AgentState runtime fields and Door export"
```

---

## Task 5: TypeScript — OfficeRenderer type annotations

**Files:**
- Modify: `frontend/src/game/OfficeRenderer.ts`
- Modify: `frontend/tsconfig.json`

- [ ] **Step 1: Remove noImplicitAny from tsconfig**

In `frontend/tsconfig.json`, remove the `"noImplicitAny": false` line. The file should have only `"strict": true`.

- [ ] **Step 2: Add type annotations to method signatures**

In `frontend/src/game/OfficeRenderer.ts`, add parameter types to these methods (exact signatures):

```typescript
drawBackdrop(): void {
drawOfficeBase(): void {
drawZones(): void {
drawRoom(zone: Zone): void {
drawOpenZone(zone: Zone): void {
drawZoneLabel(zone: Zone): void {
drawGrid(): void {
drawZoneLabels(): void {
drawErrorZoneOverlays(agents: Agent[]): void {
getAgentZone(agent: Agent): Zone | null {
getAgentActivity(agent: Agent): string {
getMovementGroupKey(agent: Agent, zone?: Zone | null, activity?: string): string {
getOccupiedDeskComputerIds(agents: Agent[], movementIndexes: Map<string, number>): Set<string> {
hasActiveMeeting(agents: Agent[]): boolean {
isDeskComputerOccupant(agent: Agent, zone?: Zone | null, activity?: string): boolean {
isDeskComputerWorker(agent: Agent, zone?: Zone | null, activity?: string): boolean {
isDeskComputerFocused(agent: Agent, state: AgentState, zone?: Zone | null, activity?: string): boolean {
getAgentVisualAssignments(agents: Agent[]): Map<string, AgentVisual> {
collectRenderables(agents: Agent[]): RenderableEntry[] {
addGhostToRenderables(renderables: RenderableEntry[]): void {
canPlaceFurnitureAt(type: string, col: number, row: number): boolean {
isFootprintWithinBounds(startCol: number, startRow: number, footprintW: number, footprintH: number): boolean {
isFootprintBlocked(startCol: number, startRow: number, footprintW: number, footprintH: number): boolean {
getFurnitureAtTile(col: number, row: number): FurnitureItem | null {
getFurniturePlacement(item: FurnitureItem, sprite: any): PlacementResult {
resolveFurnitureSprite(asset: any, item?: any): any {
resolveRotationNode(node: any, rotation: number): any {
drawFurnitureSprite(ctx: CanvasRenderingContext2D, sprite: any, x: number, y: number, options?: any): void {
drawComputerGlow(ctx: CanvasRenderingContext2D, placement: any, sprite: any): void {
drawCoffeeSteam(ctx: CanvasRenderingContext2D, placement: any, sprite: any): void {
drawAgentSprite(ctx: CanvasRenderingContext2D, agent: Agent, placeX: number, placeY: number, visual: any): void {
drawAgentNameLabel(ctx: CanvasRenderingContext2D, agent: Agent, drawX: number, drawY: number, drawWidth: number, spriteScale: number): void {
drawAgentPoseProp(ctx: CanvasRenderingContext2D, prop: any, placement: any): void {
getDesiredAgentTarget(agent: Agent, index: number, zone: Zone | null, candidates: any[], anchorTile?: TilePos): InteractionTarget | null {
updateAgentMovement(agent: Agent, index: number): void {
getAgentTargetTile(agent: Agent, index: number, zone?: Zone | null, candidates?: any[]): InteractionTarget | null {
getRoamDelay(agent: Agent): number {
getNextRoamTime(agent: Agent): number {
getNextRoamTarget(agent: Agent, state: AgentState, candidates: any[], anchorTile?: TilePos): TilePos | null {
isWalkableTile(col: number, row: number): boolean {
hashCode(str: string): number {
findSupportingSurfaceItem(item: FurnitureItem): any {
getSurfaceInsetX(support: any, localCol: number, drawWidth: number): number {
getSurfaceInsetY(support: any, localRow: number): number {
getSurfacePalette(surface: string): any {
drawTiledFloor(col: number, row: number, width: number, height: number, floorIndex: number): void {
fillTileRect(col: number, row: number, width: number, height: number, color: string, alpha?: number, lineAlpha?: number): void {
```

Also add local interface at the top of the file:

```typescript
interface AgentVisual {
  characterIndex: number
  hueShift: number
}

interface RenderableEntry {
  sortY: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

interface SurfaceConfig {
  floorIndex?: number
  tint?: string | null
  surface?: string
}
```

Type internal arrays in `collectRenderables`:
```typescript
const renderables: RenderableEntry[] = []
const zoneIndexes = new Map<string, number>()
const movementGroups = new Map<string, Agent[]>()
const movementIndexes = new Map<string, number>()
```

- [ ] **Step 3: Run typecheck to verify**

```bash
cd frontend && npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Build to verify**

```bash
cd frontend && npm run build
```

Expected: builds successfully.

- [ ] **Step 5: Run tests**

```bash
cd frontend && npm run test
```

Expected: 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/game/OfficeRenderer.ts frontend/tsconfig.json frontend/src/types.ts
git commit -m "types: enable strict implicit any on OfficeRenderer"
```

---
