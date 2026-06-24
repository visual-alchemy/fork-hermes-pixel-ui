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
