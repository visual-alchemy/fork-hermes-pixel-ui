import type { Agent, AgentStatus } from '../types'

interface AgentCard {
  id: string
  name: string
  status: AgentStatus
  location: string
  avatar: string | null
  zoneLabel: string
  displayTask: string
  statusLabel: string
  isCompact: boolean
  roleLabel: string
}

interface StaffPanelProps {
  agentCards: AgentCard[]
  connected: boolean
  selectedAgentId: string | null
  onSelectAgent: (id: string) => void
}

export function StaffPanel({
  agentCards,
  connected,
  selectedAgentId,
  onSelectAgent,
}: StaffPanelProps) {
  return (
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
              onClick={() => onSelectAgent(agent.id)}
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
  )
}
