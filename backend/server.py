"""
Hermes Pixel UI - Backend Server
Conecta Hermes con una interfaz visual de oficina pixel art
"""

from pydantic import BaseModel
from typing import Optional as Opt

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Configuración
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)
STALE_AGENT_TTL_HOURS = 1
INACTIVE_AGENT_TIMEOUT_SECONDS = 600  # 10 minutos
DONE_AGENT_TIMEOUT_SECONDS = 45
RECENT_WORK_GRACE_SECONDS = 18
CAFFEINATE_DISABLE_ENV = "PIXEL_UI_DISABLE_CAFFEINATE"

app = FastAPI(title="Hermes Pixel UI", version="0.1.0")
caffeinate_process: Optional[subprocess.Popen] = None

# CORS para desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Estado global de agentes

class AgentState:
    def __init__(self):
        self.agents: Dict[str, dict] = {}
        self.connections: List[WebSocket] = []
        from db import AgentStore
        self.store = AgentStore()
        self._save_enabled = True

    async def _save_to_file(self):
        pass

    async def _load_from_file(self):
        try:
            agents = await self.store.get_all_agents()
            for agent in agents:
                self.agents[agent["id"]] = agent
            logger.info(f"Loaded {len(agents)} agents from SQLite")
        except Exception as e:
            logger.warning(f"Could not load agents from SQLite: {e}")

    async def prune_stale_agents(self):
        await self.store.prune_stale(STALE_AGENT_TTL_HOURS)
    
    def add_agent(self, agent_id: str, name: str = None):
        now_iso = datetime.now().isoformat()
        self.agents[agent_id] = {
            "id": agent_id,
            "name": name or f"Agente {len(self.agents) + 1}",
            "status": "idle",  # idle, working, waiting, done, error
            "task": None,
            "replay": False,
            "replay_tool": None,
            "location": "desk",  # desk, meeting, cafe, library, lounge
            "activity": "computer",
            "desk_id": None,
            "created_at": now_iso,
            "last_activity": now_iso,
            "last_work_location": "desk",
            "last_work_activity": "computer",
            "last_work_at": now_iso,
        }
        logger.info(f"Agente creado: {agent_id} ({self.agents[agent_id]['name']})")
        import asyncio as _asyncio_add
        _asyncio_add.ensure_future(self.store.upsert_agent(self.agents[agent_id]))
        return self.agents[agent_id]
    
    def update_agent(self, agent_id: str, **kwargs):
        if agent_id in self.agents:
            self.agents[agent_id].update(kwargs)
            self.agents[agent_id]["last_activity"] = datetime.now().isoformat()
            import asyncio as _asyncio
            _asyncio.ensure_future(self.store.upsert_agent(self.agents[agent_id]))
            return self.agents[agent_id]
        return None
    
    def remove_agent(self, agent_id: str):
        if agent_id in self.agents:
            agent = self.agents.pop(agent_id)
            logger.info(f"Agente removido: {agent_id}")
            import asyncio as _asyncio_rem
            _asyncio_rem.ensure_future(self.store.delete_agent(agent_id))
            return agent
        return None
    
    async def get_all_agents(self) -> List[dict]:
        await self.prune_stale_agents()
        return list(self.agents.values())

state = AgentState()


# Gestor de Layout Presets
PRESETS_DIR = Path(__file__).parent / "presets"
ACTIVE_LAYOUT_FILE = PRESETS_DIR / "active_layout.txt"
DEFAULT_LAYOUT_SRC = Path(__file__).parent.parent / "layouts" / "default.json"

class LayoutManager:
    def __init__(self):
        self.active_layout_id: str = "default"
        self.active_layout: dict = {}
        self._init_presets()

    def _init_presets(self):
        PRESETS_DIR.mkdir(exist_ok=True)
        default_dst = PRESETS_DIR / "default.json"
        
        # Copiar layout base si no existe
        if not default_dst.exists():
            if DEFAULT_LAYOUT_SRC.exists():
                shutil.copy(DEFAULT_LAYOUT_SRC, default_dst)
                logger.info("📁 Copiado default.json a la carpeta de presets")
            else:
                # Fallback layout básico si no se encuentra default.json
                logger.warning(f"⚠️ No se encontró el layout de origen en {DEFAULT_LAYOUT_SRC}")
                fallback_layout = {
                    "name": "Hermes Batcave Operations",
                    "version": "0.4.0",
                    "gridSize": 32,
                    "dimensions": {"width": 28, "height": 26},
                    "theme": {
                        "walkwayFloorIndex": 4,
                        "walkwaySurface": "hall",
                        "wallColor": "#121620",
                        "trimColor": "#00b4d8",
                        "shadowColor": "rgba(0, 0, 0, 0.45)",
                        "officeBounds": {"x": 1, "y": 1, "width": 26, "height": 24}
                    },
                    "zones": [],
                    "furniture": []
                }
                with open(default_dst, "w", encoding="utf-8") as f:
                    json.dump(fallback_layout, f, indent=2)

        # Cargar id del layout activo
        if ACTIVE_LAYOUT_FILE.exists():
            try:
                layout_id = ACTIVE_LAYOUT_FILE.read_text(encoding="utf-8").strip()
                if (PRESETS_DIR / f"{layout_id}.json").exists():
                    self.active_layout_id = layout_id
                else:
                    self.active_layout_id = "default"
            except Exception as e:
                logger.warning(f"⚠️ Error al leer active_layout.txt: {e}")
                self.active_layout_id = "default"
        else:
            self.active_layout_id = "default"
            try:
                ACTIVE_LAYOUT_FILE.write_text("default", encoding="utf-8")
            except Exception:
                pass

        # Cargar layout activo
        self.load_active_layout()

    def load_active_layout(self):
        layout_path = PRESETS_DIR / f"{self.active_layout_id}.json"
        try:
            with open(layout_path, "r", encoding="utf-8") as f:
                self.active_layout = json.load(f)
            self.active_layout["id"] = self.active_layout_id
            logger.info(f"📂 Layout activo cargado: {self.active_layout_id}")
        except Exception as e:
            logger.error(f"❌ Error al cargar layout {self.active_layout_id}: {e}")
            # Fallback a default.json
            if self.active_layout_id != "default":
                self.active_layout_id = "default"
                self.load_active_layout()

    def get_presets(self) -> List[dict]:
        presets = []
        for file_path in PRESETS_DIR.glob("*.json"):
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                stat = file_path.stat()
                presets.append({
                    "id": file_path.stem,
                    "name": data.get("name", file_path.stem),
                    "is_default": file_path.stem == "default",
                    "modified_at": datetime.fromtimestamp(stat.st_mtime).isoformat()
                })
            except Exception as e:
                logger.warning(f"⚠️ Error al leer preset {file_path.name}: {e}")
        return sorted(presets, key=lambda x: (not x["is_default"], x["name"]))

    def get_layout(self, layout_id: str) -> Optional[dict]:
        layout_path = PRESETS_DIR / f"{layout_id}.json"
        if not layout_path.exists():
            return None
        try:
            with open(layout_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None

    def save_layout(self, name: str, layout_data: dict, layout_id: Optional[str] = None) -> str:
        if not layout_id:
            safe_name = "".join(c for c in name if c.isalnum() or c in (" ", "_", "-")).strip().lower()
            safe_name = safe_name.replace(" ", "_")
            if not safe_name:
                safe_name = f"preset_{int(datetime.now().timestamp())}"
            layout_id = safe_name
            if layout_id == "default":
                layout_id = "default_custom"
        
        # Evitar guardar el id temporal en el archivo JSON
        data_to_save = layout_data.copy()
        data_to_save.pop("id", None)
        data_to_save["name"] = name
        
        layout_path = PRESETS_DIR / f"{layout_id}.json"
        with open(layout_path, "w", encoding="utf-8") as f:
            json.dump(data_to_save, f, indent=2, ensure_ascii=False)
            
        logger.info(f"💾 Preset guardado: {layout_id} ({name})")
        return layout_id

    def activate_layout(self, layout_id: str) -> bool:
        layout_path = PRESETS_DIR / f"{layout_id}.json"
        if not layout_path.exists():
            return False
        
        self.active_layout_id = layout_id
        self.load_active_layout()
        
        try:
            ACTIVE_LAYOUT_FILE.write_text(layout_id, encoding="utf-8")
        except Exception as e:
            logger.warning(f"⚠️ No se pudo guardar active_layout.txt: {e}")
            
        return True

    def delete_layout(self, layout_id: str) -> bool:
        if layout_id == "default":
            return False
            
        layout_path = PRESETS_DIR / f"{layout_id}.json"
        if not layout_path.exists():
            return False
            
        layout_path.unlink()
        logger.info(f"🗑️ Preset eliminado: {layout_id}")
        
        if self.active_layout_id == layout_id:
            self.activate_layout("default")
            
        return True

layout_manager = LayoutManager()

class SaveLayoutRequest(BaseModel):
    name: str
    layout: dict
    layout_id: Optional[str] = None


def _parse_iso_timestamp(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None

    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _is_recent_work_focus(agent: Optional[dict]) -> bool:
    if not agent:
        return False

    last_work_at = _parse_iso_timestamp(agent.get("last_work_at"))
    if not last_work_at:
        return False

    age_seconds = (datetime.now() - last_work_at).total_seconds()
    return age_seconds <= RECENT_WORK_GRACE_SECONDS


def start_caffeinate_guard():
    global caffeinate_process

    if caffeinate_process and caffeinate_process.poll() is None:
        return

    if os.getenv(CAFFEINATE_DISABLE_ENV) == "1":
        logger.info("☕ Caffeinate desactivado por entorno (%s=1)", CAFFEINATE_DISABLE_ENV)
        return

    if sys.platform != "darwin":
        logger.info("☕ Caffeinate omitido: solo se usa en macOS")
        return

    caffeinate_binary = shutil.which("caffeinate")
    if not caffeinate_binary:
        logger.warning("☕ Caffeinate no disponible en PATH")
        return

    try:
        caffeinate_process = subprocess.Popen(
            [caffeinate_binary, "-dims", "-w", str(os.getpid())],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        logger.info("☕ Caffeinate activado para mantener el Mac despierto mientras corre el backend")
    except Exception as exc:
        logger.warning("☕ No se pudo iniciar caffeinate: %s", exc)
        caffeinate_process = None


def stop_caffeinate_guard():
    global caffeinate_process

    if not caffeinate_process:
        return

    if caffeinate_process.poll() is None:
        try:
            caffeinate_process.terminate()
            caffeinate_process.wait(timeout=2)
        except Exception:
            try:
                caffeinate_process.kill()
            except Exception:
                pass

    caffeinate_process = None

# WebSocket manager
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    state.connections.append(websocket)
    
    # Enviar estado inicial
    await websocket.send_json({
        "type": "init",
        "agents": await state.get_all_agents(),
        "layout": layout_manager.active_layout,
        "timestamp": datetime.now().isoformat()
    })
    
    try:
        while True:
            # Mantener conexión viva, recibir mensajes del frontend
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif message.get("type") == "get_agents":
                await websocket.send_json({
                    "type": "agents_update",
                    "agents": await state.get_all_agents()
                })
    except WebSocketDisconnect:
        state.connections.remove(websocket)
    except Exception as e:
        logger.error(f"Error WebSocket: {e}")
        if websocket in state.connections:
            state.connections.remove(websocket)

# API REST
@app.get("/api/agents")
async def get_agents():
    """Obtener todos los agentes activos"""
    return {"agents": await state.get_all_agents()}

@app.get("/api/agents/{agent_id}")
async def get_agent(agent_id: str):
    """Obtener un agente específico"""
    if agent_id in state.agents:
        return {"agent": state.agents[agent_id]}
    return {"error": "Agente no encontrado"}, 404

@app.post("/api/agents")
async def create_agent(agent_data: dict):
    """Crear un nuevo agente"""
    agent_id = agent_data.get("id", f"agent_{len(state.agents) + 1}")
    name = agent_data.get("name")
    agent = state.add_agent(agent_id, name)
    
    # Broadcast a todos los clientes
    await broadcast({
        "type": "agent_created",
        "agent": agent
    })
    
    return {"agent": agent}

@app.put("/api/agents/{agent_id}")
async def update_agent(agent_id: str, agent_data: dict):
    """Actualizar estado de un agente"""
    agent = state.update_agent(agent_id, **agent_data)
    if agent:
        await broadcast({
            "type": "agent_updated",
            "agent": agent
        })
        return {"agent": agent}
    return {"error": "Agente no encontrado"}, 404

@app.delete("/api/agents/{agent_id}")
async def delete_agent(agent_id: str):
    """Eliminar un agente"""
    agent = state.remove_agent(agent_id)
    if agent:
        await broadcast({
            "type": "agent_removed",
            "agent_id": agent_id
        })
        return {"message": "Agente eliminado"}
    return {"error": "Agente no encontrado"}, 404

@app.get("/api/status")
async def get_status():
    """Estado del sistema"""
    return {
        "status": "running",
        "agents_count": len(state.agents),
        "connections_count": len(state.connections),
        "live_sessions": len(getattr(hermes_bridge, 'live_sessions', set())),
        "timestamp": datetime.now().isoformat()
    }

@app.get("/api/layouts")
async def get_layouts():
    """Listar todos los presets de layouts disponibles"""
    return {"presets": layout_manager.get_presets()}

@app.get("/api/layouts/active")
async def get_active_layout():
    """Obtener el layout activo actual"""
    return layout_manager.active_layout

@app.get("/api/layouts/{layout_id}")
async def get_layout(layout_id: str):
    """Obtener un preset de layout específico"""
    layout = layout_manager.get_layout(layout_id)
    if layout:
        return layout
    return {"error": "Layout no encontrado"}, 404

@app.post("/api/layouts")
async def save_layout(req: SaveLayoutRequest):
    """Guardar un nuevo preset de layout"""
    layout_id = layout_manager.save_layout(req.name, req.layout, req.layout_id)
    return {"status": "ok", "layout_id": layout_id, "name": req.name}

@app.post("/api/layouts/{layout_id}/activate")
async def activate_layout(layout_id: str):
    """Activar un preset de layout y notificar a los clientes"""
    success = layout_manager.activate_layout(layout_id)
    if success:
        await broadcast({
            "type": "layout_updated",
            "layout": layout_manager.active_layout
        })
        return {"status": "ok", "layout_id": layout_id}
    return {"error": "Layout no encontrado"}, 404

@app.delete("/api/layouts/{layout_id}")
async def delete_layout(layout_id: str):
    """Eliminar un preset de layout"""
    if layout_id == "default":
        return {"error": "No se puede eliminar el layout predeterminado"}, 400
    
    was_active = (layout_manager.active_layout_id == layout_id)
    
    success = layout_manager.delete_layout(layout_id)
    if success:
        if was_active:
            await broadcast({
                "type": "layout_updated",
                "layout": layout_manager.active_layout
            })
        return {"status": "ok"}
    return {"error": "Layout no encontrado"}, 404

# Broadcast a todos los clientes conectados
async def broadcast(message: dict):
    """Enviar mensaje a todos los clientes WebSocket"""
    if not state.connections:
        return
    
    message["timestamp"] = datetime.now().isoformat()
    disconnected = []
    
    for connection in state.connections:
        try:
            await connection.send_json(message)
        except Exception as e:
            logger.error(f"Error broadcast: {e}")
            disconnected.append(connection)
    
    # Limpiar conexiones desconectadas
    for conn in disconnected:
        if conn in state.connections:
            state.connections.remove(conn)


# -----------------------------------------------------------------------
# Real-time event endpoint — receives HTTP POST from Hermes plugin
# -----------------------------------------------------------------------

LIVE_SESSION_TTL_SECONDS = 600

class HermesPluginEvent(BaseModel):
    event: str
    tool_name: str = ""
    tool_call_id: str = ""
    session_id: str = ""
    task_id: str = ""
    args_preview: str = ""
    result_preview: str = ""
    user_message: str = ""
    assistant_response: str = ""
    model: str = ""
    platform: str = ""
    timestamp: str = ""


@app.post("/api/hermes-event")
async def receive_hermes_event(payload: HermesPluginEvent):
    """Receive real-time events from the Hermes plugin.

    This endpoint is called by the pixel-ui-bridge plugin installed
    in ~/.hermes/plugins/.  Events arrive *during* Hermes execution,
    not after the .jsonl flush.
    """
    session_id = payload.session_id or payload.task_id
    if not session_id:
        return {"status": "ignored", "reason": "no session_id"}

    # Mark this session as live so the bridge skips replay
    hermes_bridge.mark_live_session(session_id)

    logger.info(f"⚡ Live event: {payload.event} tool={payload.tool_name} session={session_id[:8]}")

    # Translate plugin event → HermesEvent understood by handle_hermes_event
    hermes_event = _translate_plugin_event(payload, session_id)
    if hermes_event:
        await handle_hermes_event(hermes_event)

    return {"status": "ok"}


def _translate_plugin_event(payload: HermesPluginEvent, session_id: str):
    """Convert a plugin HTTP event into a HermesEvent."""
    from hermes_bridge import HermesEvent

    if payload.event == "session_start":
        return HermesEvent("agent_started", {
            "agent_id": session_id,
            "name": f"Hermes-{session_id[:6]}",
            "task": "Session iniciada",
        })

    if payload.event == "tool_start":
        tool_name = payload.tool_name or "unknown"
        context_parts = [tool_name, payload.args_preview]
        return HermesEvent("tool_call", {
            "agent_id": session_id,
            "tool": tool_name,
            "tools": [tool_name],
            "tool_context": " ".join(part for part in context_parts if part)[:420],
            "task": f"Using {tool_name}",
            "status": "working",
            "replay": False,
        })

    if payload.event == "tool_end":
        tool_name = payload.tool_name or "unknown"
        return HermesEvent("tool_call", {
            "agent_id": session_id,
            "tool": tool_name,
            "tools": [tool_name],
            "tool_context": f"{tool_name} completed: {payload.result_preview}"[:420],
            "task": f"Completed {tool_name}",
            "status": "working",
            "replay": False,
        })

    if payload.event == "llm_start":
        user_message = (payload.user_message or "")[:420]
        return HermesEvent("agent_thinking", {
            "agent_id": session_id,
            "task": "Thinking",
            "task_context": user_message,
            "model": payload.model,
            "platform": payload.platform,
        })

    if payload.event == "llm_end":
        return HermesEvent("agent_idle", {
            "agent_id": session_id,
            "task": "Idle",
        })

    if payload.event == "session_end":
        return HermesEvent("agent_done", {
            "agent_id": session_id,
            "result": "Session finalizada",
        })

    return None

# Servir frontend estático
frontend_path = Path(__file__).parent.parent / "frontend" / "dist"
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="static")
else:
    @app.get("/")
    async def root():
        return {
            "message": "Hermes Pixel UI Backend",
            "status": "running",
            "frontend": "not built yet - run npm install && npm run build in frontend/",
            "websocket": "ws://localhost:9000/ws",
            "api_docs": "http://localhost:9000/docs"
        }

# Hermes Bridge - Escucha eventos de Hermes
from hermes_bridge import HermesBridge, HermesEvent

hermes_bridge = HermesBridge()


def _contains_any(text: str, needles: List[str]) -> bool:
    return any(needle in text for needle in needles)


LOCATION_ACTIVITY_MAP = {
    "desk": "computer",
    "library": "research",
    "meeting": "meeting",
    "cafe": "break",
    "lounge": "rest",
    "lab": "computer",
}


def _score_location(text: str) -> Dict[str, int]:
    normalized = (text or "").lower().strip()
    scores = {
        "desk": 0,
        "library": 0,
        "meeting": 0,
        "cafe": 0,
        "lab": 0,
    }

    weighted_rules = {
        "desk": [
            ("browser", 4),
            ("http", 3),
            ("web", 3),
            ("internet", 4),
            ("navigate", 4),
            ("snapshot", 3),
            ("vision", 3),
            ("browser_console", 3),
            ("terminal", 3),
            ("execute_code", 4),
            ("process", 2),
            ("patch", 3),
            ("write_file", 3),
            ("write", 2),
            ("code", 2),
        ],
        "library": [
            ("memory", 4),
            ("read_file", 5),
            ("search_files", 5),
            ("skill_", 4),
            ("skill", 2),
            ("document", 4),
            ("documents", 4),
            ("docs", 4),
            ("pdf", 4),
            ("report", 3),
            ("notes", 3),
            ("spec", 3),
            ("file", 2),
            ("read", 2),
            ("revisa", 3),
            ("revisar", 3),
            ("archivo", 3),
            ("archivos", 3),
            ("email", 4),
            ("mail", 4),
            ("gmail", 4),
            ("inbox", 4),
            ("himalaya", 4),
        ],
        "meeting": [
            ("meeting", 5),
            ("brainstorm", 5),
            ("think", 4),
            ("plan", 5),
            ("design", 4),
            ("strategy", 4),
            ("send_message", 5),
            ("discuss", 4),
            ("discussion", 4),
            ("coordina", 4),
            ("coordinar", 4),
            ("idea", 3),
            ("ideas", 3),
            ("arquitectura", 3),
            ("architecture", 3),
        ],
        "cafe": [
            ("wait", 4),
            ("waiting", 4),
            ("espera", 4),
            ("esperando", 4),
            ("clarify", 5),
            ("confirm", 3),
            ("confirma", 3),
            ("reply", 3),
            ("respuesta", 3),
            ("user input", 3),
            ("pendiente", 3),
            ("cuando quieras", 4),
        ],
        "lab": [
            ("test", 4),
            ("testing", 4),
            ("verify", 4),
            ("verification", 4),
            ("assert", 3),
            ("pytest", 5),
            ("unittest", 5),
            ("run_tests", 5),
            ("experiment", 4),
            ("science", 4),
            ("applied", 3),
            ("compile", 3),
            ("build", 3),
        ],
    }

    for location, rules in weighted_rules.items():
        for needle, weight in rules:
            if needle in normalized:
                scores[location] += weight

    return scores


def _classify_focus(tools: List[str], task: str, tool_context: str = "") -> tuple[str, str]:
    scores = {
        "desk": 0,
        "library": 0,
        "meeting": 0,
        "cafe": 0,
        "lab": 0,
    }

    for tool_name in tools:
        tool_scores = _score_location(tool_name)
        for location, value in tool_scores.items():
            scores[location] += value * 2

    task_scores = _score_location(task)
    for location, value in task_scores.items():
        scores[location] += value

    context_scores = _score_location(tool_context)
    for location, value in context_scores.items():
        scores[location] += value

    priority = {
        "meeting": 5,
        "lab": 4,
        "library": 3,
        "desk": 2,
        "cafe": 1,
    }
    best_location = max(scores, key=lambda location: (scores[location], priority[location]))

    if scores[best_location] <= 0:
        best_location = "desk"

    return best_location, LOCATION_ACTIVITY_MAP[best_location]

async def handle_hermes_event(event: HermesEvent):
    """Procesar eventos que vienen de Hermes"""
    logger.info(f"📬 Evento de Hermes: {event.type}")
    
    agent_id = event.data.get("agent_id")
    if not agent_id:
        return

    current_agent = state.agents.get(agent_id)

    # Mapeo de ubicaciones basado en el tipo de evento/tarea
    location = current_agent.get("location", "desk") if current_agent else "desk"
    activity = current_agent.get("activity", "computer") if current_agent else "computer"
    status = "idle"
    task = event.data.get("task", "")
    is_replay = bool(event.data.get("replay"))
    replay_tool = None

    if event.type == "agent_started":
        status = "working"
        location = "desk"
        activity = "computer"
        task = event.data.get("task", "Iniciando sesión")
        is_replay = False
    elif event.type == "tool_call":
        status = "working"
        tools = [str(tool).lower() for tool in event.data.get("tools", []) if tool]
        tool = event.data.get("tool", "").lower()
        if tool and tool not in tools:
            tools.insert(0, tool)
        replay_tool = tool or (tools[0] if tools else None)
        task = event.data.get("task") or f"Usando {', '.join(tools[:2]) or tool or 'herramientas'}"
        tool_context = event.data.get("tool_context", "")
        location, activity = _classify_focus(tools, task, tool_context)
    elif event.type == "agent_active":
        status = "working"
        task = event.data.get("task", "Interactuando")
        task_context = event.data.get("task_context", "")
        location, activity = _classify_focus([], task_context or task)
        is_replay = False
    elif event.type == "agent_thinking":
        status = "working"
        task = event.data.get("task", "Thinking")
        task_context = event.data.get("task_context", "")
        location, activity = _classify_focus(["think"], task, task_context)
        is_replay = False
    elif event.type == "agent_waiting":
        status = "waiting"
        location = "cafe"
        activity = "break"
        task = event.data.get("task", "Esperando respuesta")
        is_replay = False
    elif event.type == "agent_idle":
        status = "idle"
        task = event.data.get("task", "Sin actividad")
        is_replay = False
        if current_agent:
            previous_location = current_agent.get("location", "desk")
            last_work_location = current_agent.get("last_work_location")
            last_work_activity = current_agent.get("last_work_activity", "computer")

            if (
                previous_location in {"desk", "library", "meeting", "lab"}
                and _is_recent_work_focus(current_agent)
                and last_work_location in {"desk", "library", "meeting", "lab"}
            ):
                location = last_work_location
                activity = last_work_activity
            elif previous_location in {"desk", "library", "meeting", "lab"}:
                location = "cafe"
                activity = "break"
            else:
                location = previous_location
                activity = current_agent.get("activity", "break")
        else:
            location = "cafe"
            activity = "break"
    elif event.type == "agent_done":
        status = "done"
        location = "lounge"
        activity = "rest"
        task = event.data.get("result") or "Completado"
        is_replay = False
    elif event.type == "agent_error":
        status = "error"
        location = "desk"
        activity = "computer"
        task = "Error"
        is_replay = False

    # Si el agente no existe, crearlo
    if agent_id not in state.agents:
        agent_name = event.data.get("name", f"Hermes-{agent_id[:6]}")
        state.add_agent(agent_id, agent_name)
    
    # Actualizar estado
    agent = state.update_agent(
        agent_id,
        status=status,
        location=location,
        activity=activity,
        task=task,
        replay=is_replay,
        replay_tool=replay_tool,
    )

    if status == "working" and location in {"desk", "library", "meeting", "lab"}:
        agent = state.update_agent(
            agent_id,
            last_work_location=location,
            last_work_activity=activity,
            last_work_at=datetime.now().isoformat(),
        )

    # Broadcast al frontend
    await broadcast({
        "type": "agent_updated",
        "agent": agent
    })

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("🚀 Hermes Pixel UI Backend iniciado")
    logger.info(f"📁 Session dir: {hermes_bridge.session_dir}")
    start_caffeinate_guard()
    
    # Configurar callback y arrancar bridge
    hermes_bridge.set_event_callback(handle_hermes_event)
    bridge_task = asyncio.create_task(hermes_bridge.start_listening())

    # Init SQLite agent store (DB for crash recovery, fresh start each session)
    await state.store.init()

    # Auto-spawn Alfred so he's always visible, chilling in the lounge
    if "hermes_current" not in state.agents:
        state.add_agent("hermes_current", "Alfred")
        state.update_agent("hermes_current", status="idle", task="Enjoying a break", location="lounge", activity="rest")
        logger.info("🦇 Alfred auto-spawned, chilling in the lounge")

    # Background task: idle agents wander between rooms
    async def idle_room_roamer():
        chill_rooms = ["cafe", "lounge", "library"]
        while True:
            await asyncio.sleep(20)
            for agent_id, agent in list(state.agents.items()):
                if agent.get("status") not in ("idle", "done"):
                    continue
                current = agent.get("location", "desk")
                others = [r for r in chill_rooms if r != current]
                if others:
                    import random
                    new_room = random.choice(others)
                    state.update_agent(agent_id, location=new_room, activity="roam")
                    await broadcast({
                        "type": "agent_updated",
                        "agent": state.agents[agent_id]
                    })

    room_roamer_task = asyncio.create_task(idle_room_roamer())
    
    yield
    
    # Shutdown
    hermes_bridge.stop()
    bridge_task.cancel()
    room_roamer_task.cancel()
    stop_caffeinate_guard()
    logger.info("👋 Hermes Pixel UI Backend detenido")

app.router.lifespan_context = lifespan

if __name__ == "__main__":
    # Silenciamos los logs de uvicorn para que solo muestren errores
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.error").setLevel(logging.WARNING)
    
    # Arrancamos sin access_log
    uvicorn.run(app, host="0.0.0.0", port=9000, access_log=False)
