import { useEffect, useRef, useState } from 'react'
import { assetLoader } from './game/AssetLoader'
import { OfficeRenderer } from './game/OfficeRenderer'
import defaultLayout from './assets/layout.json'

const statusLabels = {
  idle: 'Idle',
  working: 'Working',
  waiting: 'Waiting',
  done: 'Done',
  error: 'Error',
}

const MAX_OFFICE_AGENTS = 12
const ACTIVE_AGENT_STATUSES = new Set(['working', 'waiting', 'error'])
const STAFF_COLLAPSE_STATUSES = new Set(['idle', 'done'])
const LAYOUT_STORAGE_KEY = 'pixel-ui-layout'

function hashCode(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index)
    hash |= 0
  }
  return hash
}

function getAgentTime(agent, field = 'last_activity') {
  const timestamp = Date.parse(agent?.[field] || '')
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function isLikelySubagent(agent) {
  const taskText = `${agent?.task || ''} ${agent?.replay_tool || ''}`.toLowerCase()
  return (
    taskText.includes('delegate') ||
    taskText.includes('subagent') ||
    taskText.includes('worker') ||
    taskText.includes('explorer')
  )
}

function getOfficeAgentPriority(agent) {
  if (agent.status === 'error') return 500
  if (agent.status === 'working') return 450
  if (agent.status === 'waiting') return 360
  if (agent.status === 'idle') return 220
  if (agent.status === 'done') return 160
  return 120
}

function getOfficeAgents(agents) {
  if (agents.length <= MAX_OFFICE_AGENTS) return agents

  return [...agents]
    .sort((left, right) => {
      const leftActive = ACTIVE_AGENT_STATUSES.has(left.status) ? 1 : 0
      const rightActive = ACTIVE_AGENT_STATUSES.has(right.status) ? 1 : 0
      if (leftActive !== rightActive) return rightActive - leftActive

      const leftPriority = getOfficeAgentPriority(left) - (isLikelySubagent(left) ? 40 : 0)
      const rightPriority = getOfficeAgentPriority(right) - (isLikelySubagent(right) ? 40 : 0)
      if (leftPriority !== rightPriority) return rightPriority - leftPriority

      return getAgentTime(right) - getAgentTime(left)
    })
    .slice(0, MAX_OFFICE_AGENTS)
}

function getStaffAgents(agents) {
  return [...agents].sort((left, right) => {
    const leftCollapsed = STAFF_COLLAPSE_STATUSES.has(left.status) && isLikelySubagent(left) ? 1 : 0
    const rightCollapsed = STAFF_COLLAPSE_STATUSES.has(right.status) && isLikelySubagent(right) ? 1 : 0
    if (leftCollapsed !== rightCollapsed) return leftCollapsed - rightCollapsed

    const leftPriority = getOfficeAgentPriority(left)
    const rightPriority = getOfficeAgentPriority(right)
    if (leftPriority !== rightPriority) return rightPriority - leftPriority

    return getAgentTime(right) - getAgentTime(left)
  })
}

function loadInitialLayout() {
  try {
    const storedLayout = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!storedLayout) return defaultLayout
    return JSON.parse(storedLayout)
  } catch (err) {
    console.warn('No se pudo cargar el layout guardado:', err)
    return defaultLayout
  }
}

function getAgentVisualAssignments(agents, characterCount) {
  const assignments = new Map()
  const count = Math.max(1, characterCount || 1)
  const usedCharacters = new Set()

  ;[...agents]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .forEach((agent, order) => {
      const agentHash = Math.abs(hashCode(String(agent.id)))
      let characterIndex = agentHash % count

      if (usedCharacters.size < count) {
        for (let offset = 0; offset < count; offset += 1) {
          const candidate = (characterIndex + offset) % count
          if (usedCharacters.has(candidate)) continue
          characterIndex = candidate
          usedCharacters.add(candidate)
          break
        }
      } else {
        characterIndex = (agentHash + order) % count
      }

      assignments.set(agent.id, {
        characterIndex,
        hueShift: (agentHash + Math.floor(order / count) * 53) % 360,
      })
    })

  return assignments
}

const preferredFurnitureOrder = [
  'DESK',
  'PC',
  'TABLE_FRONT',
  'SMALL_TABLE',
  'WHITEBOARD',
  'CLOCK',
  'COFFEE',
  'WOODEN_CHAIR',
  'CUSHIONED_CHAIR',
  'SOFA',
  'BOOKSHELF',
  'DOUBLE_BOOKSHELF',
  'PLANT',
  'PLANT_2',
  'LARGE_PLANT',
  'BIN',
]

const furnitureLabels = {
  BIN: 'Bin',
  BOOKSHELF: 'Bookshelf',
  CACTUS: 'Cactus',
  CLOCK: 'Wall Clock',
  COFFEE: 'Cup / Coffee',
  COFFEE_TABLE: 'Coffee Table',
  CUSHIONED_BENCH: 'Bench',
  CUSHIONED_CHAIR: 'Cafe Chair',
  DESK: 'Desk',
  DOUBLE_BOOKSHELF: 'Double Shelf',
  HANGING_PLANT: 'Hanging Plant',
  LARGE_PAINTING: 'Large Painting',
  LARGE_PLANT: 'Large Plant',
  PC: 'Computer',
  PLANT: 'Plant',
  PLANT_2: 'Tall Plant',
  POT: 'Pot',
  SMALL_PAINTING: 'Small Painting',
  SMALL_PAINTING_2: 'Small Painting 2',
  SMALL_TABLE: 'Small Table',
  SOFA: 'Sofa',
  TABLE_FRONT: 'Meeting Table',
  WHITEBOARD: 'Whiteboard',
  WOODEN_BENCH: 'Wood Bench',
  WOODEN_CHAIR: 'Wood Chair',
}

function App() {
  const [agents, setAgents] = useState([])
  const [layout, setLayout] = useState(loadInitialLayout)
  const [editMode, setEditMode] = useState(false)
  const [selectedType, setSelectedType] = useState('DESK')
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedAgentId, setSelectedAgentId] = useState(null)
  const [terminalLogs, setTerminalLogs] = useState([])
  const [agentLogs, setAgentLogs] = useState({})

  const canvasRef = useRef(null)
  const wsRef = useRef(null)
  const rendererRef = useRef(null)
  const agentsRef = useRef([])

  const addLog = (agentId, agentName, type, text) => {
    const timestamp = new Date().toLocaleTimeString()
    const logItem = { id: `log_${Date.now()}_${Math.random()}`, timestamp, agentName: agentName || 'SYSTEM', type, text }

    setTerminalLogs((prev) => [logItem, ...prev].slice(0, 100))

    if (agentId) {
      setAgentLogs((prev) => {
        const currentList = prev[agentId] || []
        return {
          ...prev,
          [agentId]: [logItem, ...currentList].slice(0, 50)
        }
      })
    }
  }

  useEffect(() => {
    if (rendererRef.current) {
      rendererRef.current.selectedAgentId = selectedAgentId
    }
  }, [selectedAgentId])

  useEffect(() => {
    const init = async () => {
      try {
        await assetLoader.loadAll()
        setLoading(false)
      } catch (err) {
        console.error('Error en la inicializacion visual:', err)
      }
    }

    void init()
  }, [])

  useEffect(() => {
    if (loading || !canvasRef.current) return

    rendererRef.current = new OfficeRenderer(canvasRef.current, assetLoader, layout)
    rendererRef.current.resize()

    return () => {
      rendererRef.current = null
    }
  }, [loading])

  useEffect(() => {
    if (loading) return

    let id = 0

    const render = () => {
      if (rendererRef.current) {
        rendererRef.current.render(agentsRef.current, layout)
      }
      id = window.requestAnimationFrame(render)
    }

    render()
    return () => window.cancelAnimationFrame(id)
  }, [loading, layout])

  useEffect(() => {
    agentsRef.current = getOfficeAgents(agents)
  }, [agents])

  useEffect(() => {
    const handleResize = () => {
      rendererRef.current?.resize()
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    rendererRef.current?.resize()
  }, [layout])

  useEffect(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    } catch (err) {
      console.warn('No se pudo guardar el layout:', err)
    }
  }, [layout])

  const handleMouseMove = (event) => {
    if (!editMode || !rendererRef.current) return
    rendererRef.current.hoverTile = rendererRef.current.getGridPos(event.clientX, event.clientY)
  }

  const handleMouseDown = (event) => {
    if (editMode) {
      if (!rendererRef.current) return
      const pos = rendererRef.current.getGridPos(event.clientX, event.clientY)

      if (event.shiftKey || event.button === 2) {
        const target = rendererRef.current.getFurnitureAtTile(pos.col, pos.row)
        if (!target) return
        const newFurniture = layout.furniture.filter((item) => item.id !== target.id)
        setLayout({ ...layout, furniture: newFurniture })
        return
      }

      if (!rendererRef.current.canPlaceFurnitureAt(selectedType, pos.col, pos.row)) return

      setLayout({
        ...layout,
        furniture: [
          ...layout.furniture,
          {
            id: `f_${Date.now()}`,
            type: selectedType.toLowerCase(),
            x: pos.col,
            y: pos.row,
            rotation: 0,
          },
        ],
      })
      return
    }

    // Agent selection mode in canvas
    if (rendererRef.current && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const clickX = event.clientX - rect.left
      const clickY = event.clientY - rect.top

      const clickedAgent = Object.entries(rendererRef.current.agentStates).find(([id, state]) => {
        const agentX = state.x + 16 // centering adjustment
        const agentY = state.y + 16
        const dist = Math.hypot(clickX - agentX, clickY - agentY)
        return dist < 24 // 24px radius click
      })

      if (clickedAgent) {
        setSelectedAgentId(clickedAgent[0])
      } else {
        setSelectedAgentId(null)
      }
    }
  }

  const resetLayout = () => {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY)
    setLayout(defaultLayout)
  }

  useEffect(() => {
    const connect = () => {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsPort = window.location.port ? `:${window.location.port}` : ''
      const ws = new WebSocket(`${wsProtocol}//${window.location.hostname}${wsPort}/ws`)

      ws.onopen = () => {
        setConnected(true)
        addLog(null, 'SYSTEM', 'system', 'WebSocket link established with Batcomputer.')
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)

        if (msg.type === 'init') {
          setAgents(msg.agents || [])
          addLog(null, 'SYSTEM', 'system', `Retrieved ${msg.agents?.length || 0} active agent telemetry links.`)
          return
        }

        if (msg.type === 'agent_updated') {
          setAgents((prev) => {
            const found = prev.some((agent) => agent.id === msg.agent.id)
            const oldAgent = prev.find((a) => a.id === msg.agent.id)
            
            if (oldAgent) {
              if (oldAgent.status !== msg.agent.status) {
                addLog(msg.agent.id, msg.agent.name, msg.agent.status, `Status: ${msg.agent.status} - "${msg.agent.task || 'Idle'}"`)
              } else if (oldAgent.task !== msg.agent.task && msg.agent.task) {
                addLog(msg.agent.id, msg.agent.name, 'info', `Task: "${msg.agent.task}"`)
              } else if (oldAgent.location !== msg.agent.location) {
                addLog(msg.agent.id, msg.agent.name, 'system', `Relocated to: ${msg.agent.location}`)
              }
            } else {
              addLog(msg.agent.id, msg.agent.name, 'info', `Monitoring started: "${msg.agent.task || 'Idle'}"`)
            }

            if (!found) return [...prev, msg.agent]
            return prev.map((agent) => (agent.id === msg.agent.id ? msg.agent : agent))
          })
          return
        }

        if (msg.type === 'agent_created') {
          setAgents((prev) => {
            if (prev.some((agent) => agent.id === msg.agent.id)) return prev
            addLog(msg.agent.id, msg.agent.name, 'info', `Agent initialized: "${msg.agent.task || 'Idle'}"`)
            return [...prev, msg.agent]
          })
          return
        }

        if (msg.type === 'agent_removed') {
          setAgents((prev) => {
            const removed = prev.find((agent) => agent.id === msg.agent_id)
            if (removed) {
              addLog(msg.agent_id, removed.name, 'warn', 'Telemetry signal offline.')
            }
            return prev.filter((agent) => agent.id !== msg.agent_id)
          })
        }
      }

      ws.onclose = () => {
        setConnected(false)
        addLog(null, 'SYSTEM', 'error', 'WebSocket telemetry link offline. Reconnecting...')
        window.setTimeout(connect, 2000)
      }

      wsRef.current = ws
    }

    connect()
    return () => wsRef.current?.close()
  }, [])

  useEffect(() => {
    rendererRef.current?.setEditMode(editMode, selectedType)
  }, [editMode, selectedType])

  const furnitureTypes = Object.keys(assetLoader.furniture || {}).sort((left, right) => {
    const leftIndex = preferredFurnitureOrder.indexOf(left)
    const rightIndex = preferredFurnitureOrder.indexOf(right)

    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      if (leftIndex !== rightIndex) return leftIndex - rightIndex
    }

    return left.localeCompare(right)
  })
  const visibleZones = layout.zones.filter(
    (zone) => zone.render !== false && zone.showInOverview !== false,
  )
  const zoneSummaries = layout.zones.map((zone) => ({
    ...zone,
    count: agents.filter((agent) => agent.location === zone.id).length,
  }))
  const visibleZoneSummaries = zoneSummaries.filter(
    (zone) => zone.render !== false && zone.showInOverview !== false,
  )
  const secondaryZoneSummaries = zoneSummaries.filter(
    (zone) => zone.render !== false && zone.showInOverview === false,
  )
  const hiddenZoneSummaries = zoneSummaries.filter((zone) => zone.render === false)
  const officeAgents = getOfficeAgents(agents)
  const hiddenOfficeAgentCount = Math.max(0, agents.length - officeAgents.length)
  const visibleOfficeAgentIds = new Set(officeAgents.map((agent) => agent.id))
  const zoneLabelMap = Object.fromEntries(
    layout.zones.map((zone) => [zone.id, zone.label || zone.name || zone.id]),
  )
  const agentVisualAssignments = getAgentVisualAssignments(
    agents,
    assetLoader.characters.length || 1,
  )
  const agentCards = getStaffAgents(agents).map((agent) => {
    const visual = agentVisualAssignments.get(agent.id) || { characterIndex: 0, hueShift: 0 }
    const replayToolLabel = agent.replay_tool ? String(agent.replay_tool).replace(/_/g, ' ') : null
    const displayTask =
      agent.replay && replayToolLabel
        ? `Using ${replayToolLabel}`
        : agent.task || statusLabels[agent.status] || agent.status || 'Idle'
    const statusLabel = statusLabels[agent.status] || agent.status || 'Idle'

    return {
      ...agent,
      avatar: loading
        ? null
        : assetLoader.getCharacterAvatar(agent.name, visual.characterIndex, visual.hueShift),
      zoneLabel: zoneLabelMap[agent.location] || agent.location || 'Desk',
      displayTask,
      statusLabel,
      isCompact: !visibleOfficeAgentIds.has(agent.id),
      roleLabel: isLikelySubagent(agent) ? 'Subagent' : 'Session',
    }
  })

  return (
    <div className="app-shell">
      <div className="app-backdrop" />

      <header className="topbar pixel-panel">
        <div className="brand-copy">
          <span className="eyebrow">Hermes Visual Layer</span>
          <h1>Batcave Operations Room</h1>
          <p>Tactical Batcave operations room with active zones to follow the agents.</p>
        </div>

        <div className="topbar-side">
          <button
            className={`toolbar-button ${editMode ? 'is-active' : ''}`}
            onClick={() => setEditMode((value) => !value)}
          >
            {editMode ? 'Close Editor' : 'Edit Scene'}
          </button>

          <div className="metrics-grid">
            <div className="metric-card">
              <span>Agents</span>
              <strong>{officeAgents.length}/{agents.length}</strong>
            </div>
            <div className="metric-card">
              <span>Zones</span>
              <strong>{visibleZones.length}</strong>
            </div>
            <div className="metric-card">
              <span>Bridge</span>
              <strong>{connected ? 'Connected' : 'Retry'}</strong>
            </div>
          </div>
        </div>
      </header>

      <main className="workspace-shell">
        <section
          className="office-stage"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onContextMenu={(event) => event.preventDefault()}
        >

          {loading ? (
            <div className="loading-panel pixel-panel">
              <span className="loading-title">Loading Assets</span>
              <p>Preparing the Batcave.</p>
            </div>
          ) : (
            <canvas ref={canvasRef} className="office-canvas" />
          )}

          {!editMode && selectedAgentId && (
            (() => {
              const selectedAgentObj = agentCards.find(a => a.id === selectedAgentId)
              const selectedAgentLogs = agentLogs[selectedAgentId] || []
              if (!selectedAgentObj) return null

              return (
                <aside className="inspector-panel pixel-panel">
                  <div className="inspector-header">
                    <span className="eyebrow">Telemetry Inspector</span>
                    <button className="inspector-clear-btn" onClick={() => setSelectedAgentId(null)}>
                      CLOSE
                    </button>
                  </div>
                  
                  <div className="inspector-avatar-box">
                    {selectedAgentObj.avatar ? (
                      <img src={selectedAgentObj.avatar} alt={selectedAgentObj.name} />
                    ) : (
                      <span>{selectedAgentObj.name.slice(0, 1)}</span>
                    )}
                  </div>

                  <div className="panel-heading" style={{ marginBottom: '8px' }}>
                    <h2 className="inspector-title" style={{ fontSize: '20px' }}>{selectedAgentObj.name}</h2>
                  </div>

                  <div className="inspector-details">
                    <div className="inspector-row">
                      <span className="inspector-label">Session ID</span>
                      <span className="inspector-value">{selectedAgentObj.id.slice(0, 8)}</span>
                    </div>
                    <div className="inspector-row">
                      <span className="inspector-label">Status</span>
                      <span className={`inspector-value status-${selectedAgentObj.status}`}>
                        {selectedAgentObj.statusLabel}
                      </span>
                    </div>
                    <div className="inspector-row">
                      <span className="inspector-label">Location</span>
                      <span className="inspector-value">{selectedAgentObj.zoneLabel}</span>
                    </div>
                    <div className="inspector-row">
                      <span className="inspector-label">Role</span>
                      <span className="inspector-value">{selectedAgentObj.roleLabel}</span>
                    </div>
                    <div className="inspector-row" style={{ flexDirection: 'column', gap: '4px', borderBottom: 'none' }}>
                      <span className="inspector-label">Current Task</span>
                      <span className="inspector-value" style={{ textAlign: 'left', maxWidth: '100%', whiteSpace: 'normal', color: 'var(--text-main)' }}>
                        {selectedAgentObj.displayTask}
                      </span>
                    </div>
                  </div>

                  <span className="inspector-section-title">Telemetry Stream</span>
                  <div className="inspector-logs">
                    {selectedAgentLogs.length === 0 ? (
                      <div className="inspector-log-item">No telemetry stream recorded.</div>
                    ) : (
                      selectedAgentLogs.map((log) => (
                        <div key={log.id} className="inspector-log-item">
                          <span className="inspector-log-time">[{log.timestamp}]</span>
                          {log.text}
                        </div>
                      ))
                    )}
                  </div>
                </aside>
              )
            })()
          )}

          {!editMode && !selectedAgentId && (
            <aside className="zone-panel pixel-panel">
              <div className="panel-heading">
                <span className="eyebrow">Workspace Zones</span>
                <h2>Zones</h2>
                <p className="panel-note">
                  Some zones share the same open room. In-map labels are the main reference.
                  {hiddenOfficeAgentCount > 0
                    ? ` ${hiddenOfficeAgentCount} inactive subagents are compacted.`
                    : ''}
                </p>
              </div>

              <div className="zone-list">
                {visibleZoneSummaries.map((zone) => (
                  <div key={zone.id} className="zone-item">
                    <span
                      className="zone-swatch"
                      style={{ background: zone.accent || zone.color || '#7dc3ff' }}
                    />
                    <div className="zone-copy">
                      <strong>{zone.label || zone.name}</strong>
                      <span>{zone.count} agents</span>
                    </div>
                  </div>
                ))}
              </div>

              {secondaryZoneSummaries.length > 0 && (
                <div className="zone-meta">
                  <span className="zone-meta-title">Secondary</span>
                  <p className="zone-meta-copy">
                    {secondaryZoneSummaries.map((zone) => zone.label || zone.name).join(', ')} stays
                    as a special corner and does not count among the 4 main rooms.
                  </p>
                </div>
              )}

              {hiddenZoneSummaries.length > 0 && (
                <div className="zone-meta">
                  <span className="zone-meta-title">Logical Only</span>
                  <p className="zone-meta-copy">
                    {hiddenZoneSummaries.map((zone) => zone.label || zone.name).join(', ')} exists as
                    a routing zone, but is not drawn as a standalone room.
                  </p>
                </div>
              )}
            </aside>
          )}

          {editMode && (
            <aside className="editor-sidebar pixel-panel">
              <div className="panel-heading">
                <span className="eyebrow">Scene Editor</span>
                <h2>Furniture</h2>
              </div>

              <div className="furniture-grid">
                {furnitureTypes.map((type) => (
                  <button
                    key={type}
                    className={`furniture-button ${selectedType === type ? 'is-selected' : ''}`}
                    onClick={() => setSelectedType(type)}
                  >
                    {furnitureLabels[type] || type.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              <p className="editor-hint">Shift or right-click to remove a piece.</p>
              <button className="toolbar-button editor-reset-button" onClick={resetLayout}>
                Reset Layout
              </button>
            </aside>
          )}

          <aside className="staff-panel pixel-panel">
            <div className="panel-heading">
              <span className="eyebrow">Activity Feed</span>
              <h2>Staff</h2>
            </div>

            <div className="connection-row">
              <span className={`connection-dot ${connected ? 'is-online' : 'is-offline'}`} />
              <span>{connected ? 'Feed connected' : 'Waiting for backend'}</span>
            </div>

            <div className="staff-list">
              {agentCards.length === 0 ? (
                <p className="empty-state">No active agents yet.</p>
              ) : (
                agentCards.map((agent) => (
                  <div 
                    key={agent.id} 
                    className={`staff-item ${agent.isCompact ? 'is-compact' : ''} ${selectedAgentId === agent.id ? 'is-selected-hud' : ''}`}
                    onClick={() => setSelectedAgentId(agent.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="staff-profile">
                      <div className="staff-avatar">
                        {agent.avatar ? (
                          <img src={agent.avatar} alt="" />
                        ) : (
                          <span>{(agent.name || '?').slice(0, 1)}</span>
                        )}
                      </div>

                      <div className="staff-main">
                        <strong>{agent.name}</strong>
                        <span>{agent.zoneLabel} · {agent.roleLabel}</span>
                        <p className="staff-task">{agent.displayTask}</p>
                      </div>
                    </div>
                    <span className={`status-pill is-${agent.status || 'idle'}`}>
                      {agent.statusLabel}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>

        {/* Real-time terminal log console */}
        <div className="terminal-console">
          <div className="terminal-header">
            <div className="terminal-title">Batcomputer Telemetry Log Stream</div>
            <div className="connection-row" style={{ borderBottom: 'none', paddingBottom: 0, gap: '6px' }}>
              <span className={`connection-dot ${connected ? 'is-online' : 'is-offline'}`} style={{ width: '8px', height: '8px' }} />
              <span style={{ fontSize: '11px', fontFamily: 'Orbitron, sans-serif' }}>{connected ? 'ONLINE' : 'LINK OFFLINE'}</span>
            </div>
          </div>
          <div className="terminal-body">
            {terminalLogs.length === 0 ? (
              <div className="terminal-line">
                <span className="terminal-timestamp">[{new Date().toLocaleTimeString()}]</span>
                <span className="terminal-text system">Awaiting telemetry handshake...</span>
              </div>
            ) : (
              terminalLogs.map((log) => (
                <div key={log.id} className="terminal-line">
                  <span className="terminal-timestamp">[{log.timestamp}]</span>
                  <span className="terminal-text system">
                    <strong>[{log.agentName}]</strong>:
                  </span>
                  <span className={`terminal-text ${log.type}`}>
                    {log.text}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
