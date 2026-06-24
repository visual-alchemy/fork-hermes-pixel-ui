import type { Agent, AgentStatus } from '../types'

interface LogItem {
  id: string
  timestamp: string
  text: string
}

interface AgentCard extends Agent {
  avatar: string | null
  zoneLabel: string
  displayTask: string
  statusLabel: string
  roleLabel: string
}

interface AgentInspectorProps {
  agent: AgentCard
  logs: LogItem[]
  onClose: () => void
}

export function AgentInspector({ agent, logs, onClose }: AgentInspectorProps) {
  return (
    <aside className="inspector-panel pixel-panel">
      <div className="inspector-header">
        <span className="eyebrow">Telemetry Inspector</span>
        <button className="inspector-clear-btn" onClick={onClose}>
          CLOSE
        </button>
      </div>

      <div className="inspector-avatar-box">
        {agent.avatar ? (
          <img src={agent.avatar} alt={agent.name} />
        ) : (
          <span>{agent.name.slice(0, 1)}</span>
        )}
      </div>

      <div className="panel-heading" style={{ marginBottom: '8px' }}>
        <h2 className="inspector-title" style={{ fontSize: '20px' }}>{agent.name}</h2>
      </div>

      <div className="inspector-details">
        <div className="inspector-row">
          <span className="inspector-label">Session ID</span>
          <span className="inspector-value">{agent.id.slice(0, 8)}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Status</span>
          <span className={`inspector-value status-${agent.status}`}>
            {agent.statusLabel}
          </span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Location</span>
          <span className="inspector-value">{agent.zoneLabel}</span>
        </div>
        <div className="inspector-row">
          <span className="inspector-label">Role</span>
          <span className="inspector-value">{agent.roleLabel}</span>
        </div>
        <div className="inspector-row" style={{ flexDirection: 'column', gap: '4px', borderBottom: 'none' }}>
          <span className="inspector-label">Current Task</span>
          <span className="inspector-value" style={{ textAlign: 'left', maxWidth: '100%', whiteSpace: 'normal', color: 'var(--text-main)' }}>
            {agent.displayTask}
          </span>
        </div>
      </div>

      <span className="inspector-section-title">Telemetry Stream</span>
      <div className="inspector-logs">
        {logs.length === 0 ? (
          <div className="inspector-log-item">No telemetry stream recorded.</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="inspector-log-item">
              <span className="inspector-log-time">[{log.timestamp}]</span>
              {log.text}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
