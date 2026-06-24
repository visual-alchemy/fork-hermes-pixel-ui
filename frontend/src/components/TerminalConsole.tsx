interface LogItem {
  id: string
  timestamp: string
  agentName: string
  type: string
  text: string
}

interface TerminalConsoleProps {
  logs: LogItem[]
  connected: boolean
}

export function TerminalConsole({ logs, connected }: TerminalConsoleProps) {
  return (
    <div className="terminal-console">
      <div className="terminal-header">
        <div className="terminal-title">Batcomputer Telemetry Log Stream</div>
        <div className="connection-row" style={{ borderBottom: 'none', paddingBottom: 0, gap: '6px' }}>
          <span className={`connection-dot ${connected ? 'is-online' : 'is-offline'}`} style={{ width: '8px', height: '8px' }} />
          <span style={{ fontSize: '11px', fontFamily: 'Orbitron, sans-serif' }}>{connected ? 'ONLINE' : 'LINK OFFLINE'}</span>
        </div>
      </div>
      <div className="terminal-body">
        {logs.length === 0 ? (
          <div className="terminal-line">
            <span className="terminal-timestamp">[{new Date().toLocaleTimeString()}]</span>
            <span className="terminal-text system">Awaiting telemetry handshake...</span>
          </div>
        ) : (
          logs.map((log) => (
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
  )
}
