"""
Hermes Bridge - Conecta con Hermes y escucha eventos

Este módulo se encarga de:
1. Escuchar eventos de Hermes (vía polling de logs o API)
2. Traducir eventos de Hermes a eventos de Pixel UI
3. Actualizar el estado de los agentes en tiempo real
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, Callable, AsyncIterator

logger = logging.getLogger(__name__)
DONE_GRACE_SECONDS = 1.6
WAITING_GRACE_SECONDS = 2.4
RESPONSE_WAITING_GRACE_SECONDS = 1.0
ACTIVE_SESSION_WINDOW_HOURS = 1
DONE_GRACE_MAX_SECONDS = 5.5
DONE_GRACE_PER_TOOL_EVENT = 0.45
REPLAY_INITIAL_DELAY_SECONDS = 0.35
REPLAY_STEP_SECONDS = 2.8
REPLAY_COMPLETION_BUFFER_SECONDS = 0.9
REPLAY_MAX_VISIBLE_SECONDS = 5.4
REPLAY_MAX_PHASES = 3
LIVE_SESSION_TTL_SECONDS = 600


class HermesEvent:
    """Evento de Hermes"""
    
    def __init__(self, event_type: str, data: dict):
        self.type = event_type
        self.data = data
        self.timestamp = datetime.now().isoformat()
    
    def to_dict(self) -> dict:
        return {
            "type": self.type,
            "data": self.data,
            "timestamp": self.timestamp
        }


class HermesBridge:
    """
    Puente entre Hermes y Pixel UI
    
    Escucha eventos de Hermes y los convierte en eventos
    que el frontend de Pixel UI puede entender.
    """
    
    def __init__(self, session_dir: Path = None):
        if session_dir is None:
            env_dir = os.getenv("HERMES_SESSIONS_DIR")
            if env_dir:
                session_dir = Path(env_dir)
            else:
                session_dir = Path.home() / ".hermes" / "sessions"
        self.session_dir = session_dir
        self.running = False
        self.event_callback: Optional[Callable] = None
        self._last_positions = {}  # Track last known positions in log files
        self._session_context = {}
        self._pending_done = {}
        self._pending_waiting = {}
        self._pending_replay = []
        self.live_sessions = {}  # session_id → last_seen_timestamp
        self._json_message_counts = {}
        self._json_started_sessions = set()
    
    def mark_live_session(self, session_id: str):
        """Mark a session as receiving live events from the Hermes plugin.

        While a session is live, the bridge skips replay scheduling for it
        because the real-time events from the plugin are already updating
        the frontend.
        """
        self.live_sessions[session_id] = datetime.now().timestamp()
        # Clean up expired live sessions
        cutoff = datetime.now().timestamp() - LIVE_SESSION_TTL_SECONDS
        expired = [sid for sid, ts in self.live_sessions.items() if ts < cutoff]
        for sid in expired:
            del self.live_sessions[sid]

    def is_live_session(self, session_id: str) -> bool:
        """Check if a session is receiving live plugin events."""
        last_seen = self.live_sessions.get(session_id)
        if last_seen is None:
            return False
        if datetime.now().timestamp() - last_seen > LIVE_SESSION_TTL_SECONDS:
            del self.live_sessions[session_id]
            return False
        return True
    
    def set_event_callback(self, callback: Callable):
        """Establecer callback para cuando llegue un evento"""
        self.event_callback = callback
    
    async def start_listening(self):
        """Iniciar escucha de eventos de Hermes"""
        logger.info(f"🔍 Hermes Bridge iniciado - Session dir: {self.session_dir}")
        self.running = True
        
        # Asegurar que el directorio existe
        if not self.session_dir.exists():
            logger.warning(f"Session dir no existe: {self.session_dir}")
            self.session_dir.mkdir(parents=True, exist_ok=True)
        
        # Bucle principal de polling
        while self.running:
            try:
                async for event in self._poll_hermes_events():
                    if self.event_callback:
                        await self.event_callback(event)
                
                await asyncio.sleep(0.5)  # Polling cada 500ms
            except Exception as e:
                logger.error(f"Error en Hermes Bridge: {e}")
                await asyncio.sleep(1)
    
    async def _poll_hermes_events(self) -> AsyncIterator[HermesEvent]:
        """
        Polling de eventos de Hermes
        
        TODO: Implementar según cómo Hermes expose eventos:
        - Opción 1: Leer archivos de log/sesión
        - Opción 2: Conectar a WebSocket de Hermes
        - Opción 3: Usar API REST de Hermes
        - Opción 4: Leer output de terminal en tiempo real
        """
        
        # Implementación temporal: simular eventos para testing
        # Esto se reemplazará con la conexión real a Hermes
        
        # Buscar archivos de sesión activos. Hermes puede persistir sesiones en
        # dos formatos: el JSONL histórico y el JSON snapshot actual.
        if self.session_dir.exists():
            json_session_files = [
                session_file
                for session_file in self.session_dir.glob("session_*.json")
                if self._is_recent_session_file(session_file)
            ]
            json_session_ids = {
                self._get_session_id_from_path(session_file)
                for session_file in json_session_files
            }

            for session_file in sorted(json_session_files, key=lambda path: path.stat().st_mtime):
                try:
                    async for event in self._parse_session_json_file(session_file):
                        yield event
                except Exception as e:
                    logger.debug(f"Error leyendo {session_file}: {e}")

            session_files = list(self.session_dir.glob("*.jsonl"))

            for session_file in session_files:
                if not self._is_recent_session_file(session_file):
                    continue
                if self._get_session_id_from_path(session_file) in json_session_ids:
                    continue
                try:
                    async for event in self._parse_session_file(session_file):
                        yield event
                except Exception as e:
                    logger.debug(f"Error leyendo {session_file}: {e}")

        async for event in self._flush_pending_replay():
            yield event

        async for event in self._flush_pending_done():
            yield event

        async for event in self._flush_pending_waiting():
            yield event
    
    def _get_session_id_from_path(self, file_path: Path) -> str:
        # Ej:
        # - session_20260420_055637_e6b5d9e5.json -> e6b5d9e5
        # - 20260420_055637_e6b5d9e5.jsonl -> e6b5d9e5
        return file_path.stem.split('_')[-1] if '_' in file_path.stem else file_path.stem

    async def _parse_session_file(self, file_path: Path) -> AsyncIterator[HermesEvent]:
        """Parsear archivo de sesión de Hermes (formato JSONL)"""
        session_id = self._get_session_id_from_path(file_path)

        if self.is_live_session(session_id):
            # The live plugin is the source of truth for this session. Keep the
            # fallback reader caught up, but do not let delayed JSONL events
            # overwrite live states such as active tool calls with stale waiting.
            try:
                with open(file_path, 'r') as f:
                    f.seek(0, 2)
                    self._last_positions[file_path] = f.tell()
            except FileNotFoundError:
                self._last_positions.pop(file_path, None)

            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            self._clear_pending_replay(session_id)
            logger.debug("Skipping JSONL fallback for live session %s", session_id[:8])
            return
        
        try:
            with open(file_path, 'r') as f:
                # Ir a la última posición conocida
                if file_path in self._last_positions:
                    f.seek(self._last_positions[file_path])

                translated_events = []
                batch_line_count = 0
                batch_tool_event_count = 0
                had_pending_done = session_id in self._pending_done

                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    batch_line_count += 1
                    
                    try:
                        data = json.loads(line)
                        event = self._translate_hermes_event(data, session_id)
                        if event:
                            translated_events.append(event)
                            if event.type == "tool_call":
                                batch_tool_event_count += max(
                                    1,
                                    len(event.data.get("tools") or []),
                                )
                    except json.JSONDecodeError:
                        continue
                
                # Guardar posición actual
                self._last_positions[file_path] = f.tell()

                should_replay_batch = batch_tool_event_count > 1 or (
                    batch_line_count > 2 and batch_tool_event_count > 0
                )

                if should_replay_batch:
                    self._clear_pending_replay(session_id)
                    tool_events = [event for event in translated_events if event.type == "tool_call"]
                    immediate_events = [event for event in translated_events if event.type != "tool_call"]
                    replay_duration = self._schedule_replay_events(session_id, tool_events)

                    if session_id in self._pending_done and not had_pending_done:
                        replay_ready_at = (
                            datetime.now().timestamp()
                            + replay_duration
                            + REPLAY_COMPLETION_BUFFER_SECONDS
                        )
                        maximum_replay_ready_at = (
                            datetime.now().timestamp() + REPLAY_MAX_VISIBLE_SECONDS
                        )
                        minimum_ready_at = min(replay_ready_at, maximum_replay_ready_at)
                        self._pending_done[session_id]["ready_at"] = max(
                            self._pending_done[session_id]["ready_at"],
                            minimum_ready_at,
                        )

                    for event in immediate_events:
                        yield event
                else:
                    for event in translated_events:
                        yield event
                
        except FileNotFoundError:
            if file_path in self._last_positions:
                del self._last_positions[file_path]

    async def _parse_session_json_file(self, file_path: Path) -> AsyncIterator[HermesEvent]:
        """Parsear snapshot de sesión de Hermes (formato session_*.json)."""
        session_id = self._get_session_id_from_path(file_path)

        if self.is_live_session(session_id):
            self._json_message_counts[file_path] = self._get_json_message_count(file_path)
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            self._clear_pending_replay(session_id)
            logger.debug("Skipping JSON fallback for live session %s", session_id[:8])
            return

        try:
            with open(file_path, "r") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return

        messages = data.get("messages")
        if not isinstance(messages, list):
            return

        previous_count = self._json_message_counts.get(file_path)
        current_count = len(messages)

        if previous_count is None or previous_count > current_count:
            start_index = max(0, current_count - 20)
        else:
            start_index = previous_count

        self._json_message_counts[file_path] = current_count

        if session_id not in self._json_started_sessions:
            self._json_started_sessions.add(session_id)
            yield HermesEvent("agent_started", {
                "agent_id": session_id,
                "name": f"Hermes-{session_id[:6]}",
                "task": "Session loaded",
                "platform": data.get("platform", ""),
            })

        if start_index >= current_count:
            return

        for message in messages[start_index:]:
            if not isinstance(message, dict):
                continue

            event = self._translate_hermes_event(message, session_id)
            if event:
                yield event

    def _get_json_message_count(self, file_path: Path) -> int:
        try:
            with open(file_path, "r") as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return 0

        messages = data.get("messages")
        return len(messages) if isinstance(messages, list) else 0

    def _get_session_context(self, session_id: str) -> dict:
        return self._session_context.setdefault(
            session_id,
            {
                "last_user_content": "",
                "last_assistant_content": "",
                "had_tool_activity": False,
                "tool_burst_count": 0,
            },
        )

    def _get_done_grace_seconds(self, context: dict) -> float:
        tool_burst_count = max(0, int(context.get("tool_burst_count", 0)))
        if tool_burst_count <= 1:
            return DONE_GRACE_SECONDS

        extra = (tool_burst_count - 1) * DONE_GRACE_PER_TOOL_EVENT
        return min(DONE_GRACE_MAX_SECONDS, DONE_GRACE_SECONDS + extra)

    def _is_recent_session_file(self, file_path: Path) -> bool:
        try:
            age_seconds = datetime.now().timestamp() - file_path.stat().st_mtime
        except FileNotFoundError:
            return False

        return age_seconds <= ACTIVE_SESSION_WINDOW_HOURS * 3600

    async def _flush_pending_waiting(self) -> AsyncIterator[HermesEvent]:
        now = datetime.now().timestamp()
        ready_sessions = [
            session_id
            for session_id, pending in self._pending_waiting.items()
            if pending["ready_at"] <= now
        ]

        for session_id in ready_sessions:
            pending = self._pending_waiting.pop(session_id, None)
            if not pending:
                continue

            yield HermesEvent("agent_waiting", {
                "agent_id": session_id,
                "task": pending["task"],
            })

    async def _flush_pending_replay(self) -> AsyncIterator[HermesEvent]:
        now = datetime.now().timestamp()
        ready_items = [item for item in self._pending_replay if item["ready_at"] <= now]
        if not ready_items:
            return

        self._pending_replay = [item for item in self._pending_replay if item["ready_at"] > now]
        ready_items.sort(key=lambda item: item["ready_at"])

        for item in ready_items:
            yield item["event"]

    async def _flush_pending_done(self) -> AsyncIterator[HermesEvent]:
        now = datetime.now().timestamp()
        ready_sessions = [
            session_id
            for session_id, pending in self._pending_done.items()
            if pending["ready_at"] <= now
        ]

        for session_id in ready_sessions:
            pending = self._pending_done.pop(session_id, None)
            if not pending:
                continue

            if pending.get("waiting_task"):
                self._pending_waiting[session_id] = {
                    "task": pending["waiting_task"],
                    "ready_at": now + WAITING_GRACE_SECONDS,
                }

            yield HermesEvent("agent_done", {
                "agent_id": session_id,
                "result": pending["result"],
            })

    def _clear_pending_done(self, session_id: str):
        self._pending_done.pop(session_id, None)

    def _clear_pending_waiting(self, session_id: str):
        self._pending_waiting.pop(session_id, None)

    def _clear_pending_replay(self, session_id: str):
        self._pending_replay = [
            item for item in self._pending_replay if item["session_id"] != session_id
        ]

    def _score_replay_focus(self, text: str) -> dict:
        normalized = (text or "").lower().strip()
        scores = {
            "desk": 0,
            "library": 0,
            "meeting": 0,
            "cafe": 0,
        }

        weighted_rules = {
            "desk": [
                ("browser", 4),
                ("browser_console", 4),
                ("browser_navigate", 4),
                ("terminal", 4),
                ("execute_code", 4),
                ("process", 3),
                ("patch", 3),
                ("write_file", 4),
                ("write", 2),
                ("code", 2),
            ],
            "library": [
                ("read_file", 5),
                ("search_files", 5),
                ("memory", 4),
                ("document", 3),
                ("docs", 3),
                ("file", 2),
                ("read", 2),
                ("archivo", 3),
                ("archivos", 3),
                ("gmail", 4),
                ("mail", 4),
                ("inbox", 4),
            ],
            "meeting": [
                ("send_message", 5),
                ("meeting", 5),
                ("brainstorm", 5),
                ("plan", 4),
                ("design", 4),
                ("strategy", 4),
            ],
            "cafe": [
                ("clarify", 4),
                ("waiting", 4),
                ("confirm", 3),
                ("reply", 2),
            ],
        }

        for focus, rules in weighted_rules.items():
            for needle, weight in rules:
                if needle in normalized:
                    scores[focus] += weight

        return scores

    def _classify_replay_focus(self, event: HermesEvent) -> str:
        scores = {
            "desk": 0,
            "library": 0,
            "meeting": 0,
            "cafe": 0,
        }

        for tool_name in event.data.get("tools", []) or []:
            for focus, value in self._score_replay_focus(str(tool_name)).items():
                scores[focus] += value * 2

        for focus, value in self._score_replay_focus(event.data.get("tool_context", "")).items():
            scores[focus] += value

        for focus, value in self._score_replay_focus(event.data.get("task", "")).items():
            scores[focus] += value

        priority = {
            "meeting": 4,
            "library": 3,
            "desk": 2,
            "cafe": 1,
        }
        best_focus = max(scores, key=lambda focus: (scores[focus], priority[focus]))
        return best_focus if scores[best_focus] > 0 else "desk"

    def _select_replay_events(self, events: list[HermesEvent]) -> list[HermesEvent]:
        if len(events) <= 1:
            return events

        phases = []

        for event in events:
            focus = self._classify_replay_focus(event)
            if phases and phases[-1]["focus"] == focus:
                phases[-1]["count"] += 1
                continue

            phases.append({
                "focus": focus,
                "event": event,
                "count": 1,
            })

        if len(phases) <= REPLAY_MAX_PHASES:
            return [phase["event"] for phase in phases]

        first_phase = phases[0]
        last_phase = phases[-1]
        selected_phases = [first_phase]
        middle_phases = phases[1:-1]

        if middle_phases:
            dominant_middle = max(
                middle_phases,
                key=lambda phase: (
                    phase["count"],
                    phase["focus"] == "library",
                    phase["focus"] == "desk",
                    phase["focus"] == "meeting",
                ),
            )
            if dominant_middle["focus"] != first_phase["focus"]:
                selected_phases.append(dominant_middle)

        if last_phase["focus"] != selected_phases[-1]["focus"] or last_phase is first_phase:
            selected_phases.append(last_phase)

        return [phase["event"] for phase in selected_phases]

    def _expand_replay_events(self, events: list[HermesEvent]) -> list[HermesEvent]:
        expanded = []

        for event in events:
            if event.type != "tool_call":
                expanded.append(event)
                continue

            tool_names = [str(tool).lower() for tool in (event.data.get("tools") or []) if tool]
            if not tool_names:
                tool_name = str(event.data.get("tool") or "").lower().strip()
                tool_names = [tool_name] if tool_name else []

            if len(tool_names) <= 1:
                expanded.append(event)
                continue

            for tool_name in tool_names:
                expanded.append(HermesEvent("tool_call", {
                    **event.data,
                    "tool": tool_name,
                    "tools": [tool_name],
                }))

        return expanded

    def _schedule_replay_events(self, session_id: str, events: list[HermesEvent]) -> float:
        if not events:
            return 0.0

        expanded_events = self._expand_replay_events(events)
        replay_events = self._select_replay_events(expanded_events)
        now = datetime.now().timestamp()

        for index, event in enumerate(replay_events):
            event.data["replay"] = True
            ready_at = now + REPLAY_INITIAL_DELAY_SECONDS + index * REPLAY_STEP_SECONDS
            self._pending_replay.append({
                "session_id": session_id,
                "ready_at": ready_at,
                "event": event,
            })

        return REPLAY_INITIAL_DELAY_SECONDS + max(0, len(replay_events) - 1) * REPLAY_STEP_SECONDS

    def _extract_text_content(self, content) -> str:
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            chunks = []
            for item in content:
                if isinstance(item, str):
                    chunks.append(item)
                    continue

                if not isinstance(item, dict):
                    continue

                text_value = item.get("text")
                if isinstance(text_value, str):
                    chunks.append(text_value)
                    continue

                for key in ("content", "value"):
                    value = item.get(key)
                    if isinstance(value, str):
                        chunks.append(value)
                        break

            return "\n".join(chunks)

        return ""

    def _normalize_text(self, text: str, limit: int = 180) -> str:
        normalized = re.sub(r"\s+", " ", text or "").strip()
        if not normalized:
            return ""

        if normalized.startswith("[System note:"):
            blocks = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]
            if blocks:
                normalized = blocks[-1]

        if len(normalized) <= limit:
            return normalized

        return normalized[: limit - 1].rstrip() + "…"

    def _extract_tool_names(self, data: dict) -> list[str]:
        tool_names = []

        for tool_call in data.get("tool_calls") or []:
            name = tool_call.get("function", {}).get("name")
            if name:
                tool_names.append(str(name).lower())

        return tool_names

    def _flatten_argument_value(self, value) -> list[str]:
        if value is None:
            return []

        if isinstance(value, str):
            return [value]

        if isinstance(value, (int, float, bool)):
            return [str(value)]

        if isinstance(value, list):
            chunks = []
            for item in value:
                chunks.extend(self._flatten_argument_value(item))
            return chunks

        if isinstance(value, dict):
            chunks = []
            for key, item in value.items():
                chunks.append(str(key))
                chunks.extend(self._flatten_argument_value(item))
            return chunks

        return [str(value)]

    def _extract_tool_context(self, data: dict) -> str:
        chunks = []

        for tool_call in data.get("tool_calls") or []:
            function = tool_call.get("function", {})
            name = function.get("name")
            if name:
                chunks.append(str(name))

            arguments = function.get("arguments")
            if isinstance(arguments, str):
                try:
                    parsed_arguments = json.loads(arguments)
                except json.JSONDecodeError:
                    parsed_arguments = arguments
            else:
                parsed_arguments = arguments

            chunks.extend(self._flatten_argument_value(parsed_arguments))

        return self._normalize_text(" ".join(chunk for chunk in chunks if chunk), limit=320)

    def _extract_reasoning_context(self, data: dict) -> str:
        return self._normalize_text(self._extract_text_content(data.get("reasoning", "")), limit=240)

    def _looks_waiting_response(self, text: str) -> bool:
        normalized = (text or "").lower().strip()
        if not normalized:
            return False

        waiting_markers = [
            "¿",
            "?",
            "quieres",
            "prefieres",
            "puedes",
            "podrías",
            "necesito",
            "cuando quieras",
            "cuando puedas",
            "dime",
            "confirma",
            "confirmar",
            "cómo quieres",
            "como quieres",
            "otra forma",
            "lo configuro",
            "pendiente",
        ]

        return any(marker in normalized for marker in waiting_markers)

    def _translate_hermes_event(self, data: dict, session_id: str = None) -> Optional[HermesEvent]:
        """
        Traducir evento de Hermes a evento de Pixel UI
        
        Formato real de mensajes de Hermes (`session_*.json` o `.jsonl`):
        - {"role": "session_meta", "tools": [...]}
        - {"role": "user", "content": "..."}
        - {"role": "assistant", "tool_calls": [...], "finish_reason": "tool_calls"}
        - {"role": "assistant", "content": "...", "finish_reason": "stop"}
        
        Usamos session_id (extraído del nombre del archivo) como agent_id.
        """
        
        role = data.get("role")
        context = self._get_session_context(session_id)
        
        # Detectar inicio de sesión = nuevo agente
        if role == "session_meta":
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            self._clear_pending_replay(session_id)
            context["had_tool_activity"] = False
            context["tool_burst_count"] = 0
            return HermesEvent("agent_started", {
                "agent_id": session_id,
                "name": f"Hermes-{session_id[:6]}",
                "task": "Session iniciada"
            })

        if role == "user":
            raw_content = self._extract_text_content(data.get("content", ""))
            if raw_content.lstrip().startswith("[System note:"):
                return None

            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            self._clear_pending_replay(session_id)
            content = self._normalize_text(raw_content)
            context["last_user_content"] = content
            context["had_tool_activity"] = False
            context["tool_burst_count"] = 0
            return HermesEvent("agent_active", {
                "agent_id": session_id,
                "task": "Processing request",
                "task_context": content,
            })
        
        # Detectar tool call = agente trabajando
        if role == "assistant" and data.get("tool_calls"):
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            context["had_tool_activity"] = True
            tool_names = self._extract_tool_names(data)
            context["tool_burst_count"] = context.get("tool_burst_count", 0) + max(1, len(tool_names))
            tool_context = self._extract_tool_context(data)
            reasoning_context = self._extract_reasoning_context(data)
            assistant_content = self._normalize_text(self._extract_text_content(data.get("content", "")))
            if assistant_content:
                context["last_assistant_content"] = assistant_content

            tool_name = tool_names[0] if tool_names else "unknown"
            return HermesEvent("tool_call", {
                "agent_id": session_id,
                "tool": tool_name,
                "tools": tool_names,
                "tool_context": self._normalize_text(
                    " ".join(part for part in [tool_context, reasoning_context] if part),
                    limit=420,
                ),
                "task": f"Using {tool_name}",
                "task_context": context.get("last_user_content", ""),
                "status": "working"
            })

        if role == "assistant" and data.get("mirror"):
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            content = self._normalize_text(self._extract_text_content(data.get("content", "")))
            if not content:
                return None

            context["last_assistant_content"] = content
            context["had_tool_activity"] = True
            context["tool_burst_count"] = context.get("tool_burst_count", 0) + 1
            return HermesEvent("tool_call", {
                "agent_id": session_id,
                "tool": "send_message",
                "tools": ["send_message"],
                "tool_context": f"send_message mirror {data.get('mirror_source', '')} {content}".strip(),
                "task": "Sending message",
                "status": "working",
            })
        
        # Detectar respuesta completada = done inmediato + waiting implícito si no llega nada después
        if role == "assistant" and data.get("finish_reason") == "stop":
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            content = self._normalize_text(self._extract_text_content(data.get("content", "")))
            context["last_assistant_content"] = content

            if context.get("had_tool_activity"):
                context["had_tool_activity"] = False
                done_grace_seconds = self._get_done_grace_seconds(context)
                context["tool_burst_count"] = 0
                self._pending_done[session_id] = {
                    "result": content[:100],
                    "waiting_task": content or "Esperando respuesta del usuario",
                    "ready_at": datetime.now().timestamp() + done_grace_seconds,
                }
                return None

            if self._looks_waiting_response(content):
                context["tool_burst_count"] = 0
                self._pending_waiting[session_id] = {
                    "task": "Waiting for reply",
                    "ready_at": datetime.now().timestamp() + RESPONSE_WAITING_GRACE_SECONDS,
                }
                return None

            context["tool_burst_count"] = 0
            return HermesEvent("agent_idle", {
                "agent_id": session_id,
                "task": "Idle",
            })
        
        # Detectar error
        if role == "assistant" and data.get("finish_reason") == "error":
            self._clear_pending_done(session_id)
            self._clear_pending_waiting(session_id)
            self._clear_pending_replay(session_id)
            context["tool_burst_count"] = 0
            return HermesEvent("agent_error", {
                "agent_id": session_id,
                "error": data.get("error", "Unknown error")
            })
        
        return None
    
    def stop(self):
        """Detener escucha de eventos"""
        logger.info("Deteniendo Hermes Bridge...")
        self.running = False


# Función de ejemplo para usar el bridge
async def example_usage():
    """Ejemplo de uso del Hermes Bridge"""
    
    bridge = HermesBridge()
    
    async def on_event(event: HermesEvent):
        print(f"📩 Evento recibido: {event.type}")
        print(f"   Datos: {event.data}")
    
    bridge.set_event_callback(on_event)
    
    print("Escuchando eventos de Hermes... (Ctrl+C para salir)")
    await bridge.start_listening()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(example_usage())
