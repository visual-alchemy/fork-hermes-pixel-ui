import { useEffect, useRef, useState, useCallback } from 'react'
import { assetLoader } from './game/AssetLoader'
import { OfficeRenderer } from './game/OfficeRenderer'
import defaultLayout from './assets/layout.json'
import { useWebSocket } from './hooks/useWebSocket'
import { useLayout } from './hooks/useLayout'
import { SceneEditor } from './components/SceneEditor'
import { AgentInspector } from './components/AgentInspector'
import { ZonePanel } from './components/ZonePanel'
import { StaffPanel } from './components/StaffPanel'
import { TerminalConsole } from './components/TerminalConsole'
import type { Agent, AgentStatus, Layout, Zone, FurnitureItem } from './types'

const statusLabels: Record<string, string> = {
  idle: 'Idle', working: 'Working', waiting: 'Waiting', done: 'Done', error: 'Error',
}
const MAX_OFFICE_AGENTS = 12
const ACTIVE_AGENT_STATUSES = new Set<AgentStatus>(['working', 'waiting', 'error'])
const STAFF_COLLAPSE_STATUSES = new Set<AgentStatus>(['idle', 'done'])
const LAYOUT_STORAGE_KEY = 'pixel-ui-layout'

function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) { hash = (hash << 5) - hash + value.charCodeAt(i); hash |= 0 }
  return hash
}
function getAgentTime(agent: Agent, field = 'last_update'): number {
  const val = (agent as unknown as Record<string, unknown>)[field]
  return Number.isNaN(Date.parse(typeof val === 'string' ? val : '')) ? 0 : Date.parse(typeof val === 'string' ? val : '')
}
function isLikelySubagent(agent: Agent): boolean {
  const t = `${agent.task || ''} ${agent.replay_tool || ''}`.toLowerCase()
  return t.includes('delegate') || t.includes('subagent') || t.includes('worker') || t.includes('explorer')
}
function getPriority(agent: Agent): number {
  if (agent.status === 'error') return 500
  if (agent.status === 'working') return 450
  if (agent.status === 'waiting') return 360
  if (agent.status === 'idle') return 220
  if (agent.status === 'done') return 160
  return 120
}
function getOfficeAgents(agents: Agent[]): Agent[] {
  if (agents.length <= MAX_OFFICE_AGENTS) return agents
  return [...agents].sort((a, b) => {
    const aAct = ACTIVE_AGENT_STATUSES.has(a.status) ? 1 : 0
    const bAct = ACTIVE_AGENT_STATUSES.has(b.status) ? 1 : 0
    if (aAct !== bAct) return bAct - aAct
    const aP = getPriority(a) - (isLikelySubagent(a) ? 40 : 0)
    const bP = getPriority(b) - (isLikelySubagent(b) ? 40 : 0)
    if (aP !== bP) return bP - aP
    return getAgentTime(b) - getAgentTime(a)
  }).slice(0, MAX_OFFICE_AGENTS)
}
function getStaffAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aC = STAFF_COLLAPSE_STATUSES.has(a.status) && isLikelySubagent(a) ? 1 : 0
    const bC = STAFF_COLLAPSE_STATUSES.has(b.status) && isLikelySubagent(b) ? 1 : 0
    if (aC !== bC) return aC - bC
    const aP = getPriority(a), bP = getPriority(b)
    if (aP !== bP) return bP - aP
    return getAgentTime(b) - getAgentTime(a)
  })
}
function loadInitialLayout(): Layout {
  const s = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
  if (!s) return defaultLayout as unknown as Layout
  try { return JSON.parse(s) as Layout } catch { return defaultLayout as unknown as Layout }
}
function getAgentVisualAssignments(agents: Agent[], cc: number) {
  const m = new Map<string, { characterIndex: number; hueShift: number }>()
  const cnt = Math.max(1, cc || 1), used = new Set<number>()
  ;[...agents].sort((a, b) => String(a.id).localeCompare(String(b.id))).forEach((ag, o) => {
    const h = Math.abs(hashCode(String(ag.id))); let ci = h % cnt
    if (used.size < cnt) { for (let off = 0; off < cnt; off++) { const c = (ci + off) % cnt; if (used.has(c)) continue; ci = c; used.add(c); break } }
    else ci = (h + o) % cnt
    m.set(ag.id, { characterIndex: ci, hueShift: (h + Math.floor(o / cnt) * 53) % 360 })
  })
  return m
}

interface LogItem { id: string; timestamp: string; agentName: string; type: string; text: string }
interface AgentVisual { characterIndex: number; hueShift: number }

const preferredFurnitureOrder: string[] = [
  'DESK', 'PC', 'TABLE_FRONT', 'SMALL_TABLE', 'WHITEBOARD', 'CLOCK', 'COFFEE',
  'WOODEN_CHAIR', 'CUSHIONED_CHAIR', 'SOFA', 'BOOKSHELF', 'DOUBLE_BOOKSHELF',
  'PLANT', 'PLANT_2', 'LARGE_PLANT', 'BIN',
]
const furnitureLabels: Record<string, string> = {
  BIN: 'Bin', BOOKSHELF: 'Bookshelf', CACTUS: 'Cactus', CLOCK: 'Wall Clock',
  COFFEE: 'Cup / Coffee', COFFEE_TABLE: 'Coffee Table', CUSHIONED_BENCH: 'Bench',
  CUSHIONED_CHAIR: 'Cafe Chair', DESK: 'Desk', DOUBLE_BOOKSHELF: 'Double Shelf',
  HANGING_PLANT: 'Hanging Plant', LARGE_PAINTING: 'Large Painting',
  LARGE_PLANT: 'Large Plant', PC: 'Computer', PLANT: 'Plant', PLANT_2: 'Tall Plant',
  POT: 'Pot', SMALL_PAINTING: 'Small Painting', SMALL_PAINTING_2: 'Small Painting 2',
  SMALL_TABLE: 'Small Table', SOFA: 'Sofa', TABLE_FRONT: 'Meeting Table',
  WHITEBOARD: 'Whiteboard', WOODEN_BENCH: 'Wood Bench', WOODEN_CHAIR: 'Wood Chair',
}

function App() {
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [selectedType, setSelectedType] = useState('DESK')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [terminalLogs, setTerminalLogs] = useState<LogItem[]>([])
  const [agentLogs, setAgentLogs] = useState<Record<string, LogItem[]>>({})

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rendererRef = useRef<OfficeRenderer | null>(null)
  const agentsRef = useRef<Agent[]>([])
  const editModeRef = useRef(false)

  useEffect(() => { editModeRef.current = editMode }, [editMode])

  const addLog = useCallback((agentId: string | null, agentName: string | null, type: string, text: string) => {
    const logItem: LogItem = { id: `log_${Date.now()}_${Math.random()}`, timestamp: new Date().toLocaleTimeString(), agentName: agentName || 'SYSTEM', type, text }
    setTerminalLogs((p) => [logItem, ...p].slice(0, 100))
    if (agentId) setAgentLogs((p) => { const l = p[agentId] || []; return { ...p, [agentId]: [logItem, ...l].slice(0, 50) } })
  }, [])

  const onInit = useCallback((l: Layout) => { setLayout(l); setServerLayout(l); if (l.id) setActivePresetId(l.id) }, [])
  const onLayoutUpdate = useCallback((l: Layout) => { setLayout(l); setServerLayout(l); if (l.id) setActivePresetId(l.id); if (editModeRef.current) void fetchPresets() }, [])

  const layoutHook = useLayout({ addLog, initialLayout: loadInitialLayout(), storageKey: LAYOUT_STORAGE_KEY })
  const { layout, setLayout, serverLayout, setServerLayout, presets, activePresetId, setActivePresetId, newPresetName, setNewPresetName, isSavingPreset, hasUnsavedChanges, fetchPresets, handleActivatePreset, handleSavePreset, handleDeletePreset, handleSaveCurrentChanges, resetLayout, handleAddFurniture, handleRemoveFurniture } = layoutHook

  const { agents, connected } = useWebSocket({ addLog, onLayoutUpdate, onInit })

  useEffect(() => { if (editMode) void fetchPresets() }, [editMode, fetchPresets])

  useEffect(() => {
    const init = async () => { try { await assetLoader.loadAll(); setLoading(false) } catch (err) { console.error('Init error:', err) } }
    void init()
  }, [])

  useEffect(() => {
    if (loading || !canvasRef.current) return
    rendererRef.current = new OfficeRenderer(canvasRef.current, assetLoader, layout)
    rendererRef.current.resize()
    return () => { rendererRef.current = null }
  }, [loading])

  useEffect(() => {
    if (loading) return
    let id = 0
    const render = () => { if (rendererRef.current) rendererRef.current.render(agentsRef.current, layout); id = requestAnimationFrame(render) }
    render()
    return () => cancelAnimationFrame(id)
  }, [loading, layout])

  useEffect(() => { agentsRef.current = getOfficeAgents(agents) }, [agents])
  useEffect(() => { rendererRef.current?.setEditMode(editMode, selectedType) }, [editMode, selectedType])
  useEffect(() => { if (rendererRef.current) rendererRef.current.selectedAgentId = selectedAgentId }, [selectedAgentId])
  useEffect(() => { const h = () => rendererRef.current?.resize(); window.addEventListener('resize', h); return () => window.removeEventListener('resize', h) }, [])
  useEffect(() => { rendererRef.current?.resize() }, [layout])

  const handleMouseMove = (event: React.MouseEvent) => {
    if (!editMode || !rendererRef.current) return
    if (event.target !== canvasRef.current) { rendererRef.current.hoverTile = null; return }
    rendererRef.current.hoverTile = rendererRef.current.getGridPos(event.clientX, event.clientY)
  }
  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.target !== canvasRef.current) return
    if (editMode && rendererRef.current) {
      const pos = rendererRef.current.getGridPos(event.clientX, event.clientY)
      if (event.shiftKey || event.button === 2) {
        const t = rendererRef.current.getFurnitureAtTile(pos.col, pos.row)
        if (t) handleRemoveFurniture(t.id)
        return
      }
      if (rendererRef.current.canPlaceFurnitureAt(selectedType, pos.col, pos.row)) handleAddFurniture(selectedType, pos.col, pos.row)
      return
    }
    if (rendererRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const cx = event.clientX - rect.left, cy = event.clientY - rect.top
      const clicked = Object.entries(rendererRef.current.agentStates).find(([, s]) => Math.hypot(cx - (s.x + 16), cy - (s.y + 16)) < 24)
      setSelectedAgentId(clicked ? clicked[0] : null)
    }
  }

  const zones = layout?.zones || []
  const zoneSummaries = zones.map((z) => ({ ...z, count: agents.filter((a) => a.location === z.id).length }))
  const visSummaries = zoneSummaries.filter((z) => z.render !== false && z.showInOverview !== false)
  const secSummaries = zoneSummaries.filter((z) => z.render !== false && z.showInOverview === false)
  const hidSummaries = zoneSummaries.filter((z) => z.render === false)
  const officeAgents = getOfficeAgents(agents)
  const hiddenCnt = Math.max(0, agents.length - officeAgents.length)
  const visAgentIds = new Set(officeAgents.map((a) => a.id))
  const zoneLabelMap = Object.fromEntries(zones.map((z) => [z.id, z.label || z.name || z.id]))
  const visualAssigns = getAgentVisualAssignments(agents, assetLoader.characters.length || 1)

  const agentCards = getStaffAgents(agents).map((a) => {
    const v = visualAssigns.get(a.id) || { characterIndex: 0, hueShift: 0 }
    const rtLabel = a.replay_tool ? String(a.replay_tool).replace(/_/g, ' ') : null
    return {
      ...a,
      avatar: loading ? null : assetLoader.getCharacterAvatar(a.name, v.characterIndex, v.hueShift),
      zoneLabel: zoneLabelMap[a.location] || a.location || 'Desk',
      displayTask: a.replay && rtLabel ? `Using ${rtLabel}` : a.task || statusLabels[a.status] || a.status || 'Idle',
      statusLabel: statusLabels[a.status] || a.status || 'Idle',
      isCompact: !visAgentIds.has(a.id),
      roleLabel: isLikelySubagent(a) ? 'Subagent' : 'Session',
    }
  })
  const selectedAgentObj = selectedAgentId ? agentCards.find((a) => a.id === selectedAgentId) : null
  const selectedAgentLogs = selectedAgentId ? (agentLogs[selectedAgentId] || []) : []
  const furnitureTypes = Object.keys(assetLoader.furniture || {}).sort((l, r) => {
    const li = preferredFurnitureOrder.indexOf(l), ri = preferredFurnitureOrder.indexOf(r)
    if (li !== -1 || ri !== -1) { if (li === -1) return 1; if (ri === -1) return -1; if (li !== ri) return li - ri }
    return l.localeCompare(r)
  })
  const visibleZones = zones.filter((z) => z.render !== false && z.showInOverview !== false)

  return (
    <div className="app-shell">
      <div className="app-backdrop" />
      <header className="topbar pixel-panel">
        <div className="brand-copy">
          <span className="eyebrow">Hermes Visual Layer</span>
          <h1>Batcave Operations Room</h1>
          <p>Active Layout: <strong>{layout?.name || 'Hermes Batcave Operations'}</strong>. Customize furniture & presets in the Scene Editor.</p>
        </div>
        <div className="topbar-side">
          {editMode && (
            <button className={`toolbar-button save-changes-btn ${hasUnsavedChanges ? 'has-unsaved' : ''}`}
              onClick={() => void handleSaveCurrentChanges()} disabled={isSavingPreset}
              style={{ borderColor: hasUnsavedChanges ? '#ff9f1c' : 'var(--accent)', background: hasUnsavedChanges ? 'rgba(255, 159, 28, 0.15)' : 'rgba(16, 21, 33, 0.7)', color: hasUnsavedChanges ? '#ffe0b2' : 'var(--text-main)', marginRight: '8px' }}>
              {isSavingPreset ? 'Saving...' : activePresetId === 'default' ? 'Save as New' : 'Save Changes'}
              {hasUnsavedChanges && <span className="unsaved-indicator" />}
            </button>
          )}
          <button className={`toolbar-button ${editMode ? 'is-active' : ''}`} onClick={() => setEditMode((v) => !v)}>
            {editMode ? 'Close Editor' : 'Edit Scene'}
          </button>
          <div className="metrics-grid">
            <div className="metric-card"><span>Agents</span><strong>{officeAgents.length}/{agents.length}</strong></div>
            <div className="metric-card"><span>Zones</span><strong>{visibleZones.length}</strong></div>
            <div className="metric-card"><span>Bridge</span><strong>{connected ? 'Connected' : 'Retry'}</strong></div>
          </div>
        </div>
      </header>
      <main className="workspace-shell">
        <section className="office-stage" onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onContextMenu={(e) => e.preventDefault()}>
          {loading ? (
            <div className="loading-panel pixel-panel"><span className="loading-title">Loading Assets</span><p>Preparing the Batcave.</p></div>
          ) : (
            <canvas ref={canvasRef} className="office-canvas" />
          )}
          {!editMode && selectedAgentObj && (
            <AgentInspector agent={selectedAgentObj} logs={selectedAgentLogs} onClose={() => setSelectedAgentId(null)} />
          )}
          {!editMode && !selectedAgentId && (
            <ZonePanel
              visibleZoneSummaries={visSummaries}
              secondaryZoneSummaries={secSummaries}
              hiddenZoneSummaries={hidSummaries}
              hiddenOfficeAgentCount={hiddenCnt}
            />
          )}
          {editMode && (
            <SceneEditor
              activePresetId={activePresetId}
              presets={presets}
              hasUnsavedChanges={hasUnsavedChanges}
              isSavingPreset={isSavingPreset}
              newPresetName={newPresetName}
              selectedType={selectedType}
              furnitureTypes={furnitureTypes}
              furnitureLabels={furnitureLabels}
              onActivatePreset={(id) => void handleActivatePreset(id)}
              onDeletePreset={(id) => void handleDeletePreset(id)}
              onSaveCurrentChanges={() => void handleSaveCurrentChanges()}
              onSetNewPresetName={setNewPresetName}
              onSavePreset={(e) => void handleSavePreset(e)}
              onSelectType={setSelectedType}
              onReset={() => void resetLayout()}
            />
          )}
          <StaffPanel
            agentCards={agentCards}
            connected={connected}
            selectedAgentId={selectedAgentId}
            onSelectAgent={setSelectedAgentId}
          />
        </section>
        <TerminalConsole logs={terminalLogs} connected={connected} />
      </main>
    </div>
  )
}

export default App
