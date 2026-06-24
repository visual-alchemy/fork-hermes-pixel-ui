import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TerminalConsole } from '../components/TerminalConsole'
import { StaffPanel } from '../components/StaffPanel'
import { ZonePanel } from '../components/ZonePanel'

describe('TerminalConsole', () => {
  it('shows awaiting message when no logs', () => {
    render(<TerminalConsole logs={[]} connected={true} />)
    expect(screen.getByText('Awaiting telemetry handshake...')).toBeInTheDocument()
  })

  it('renders log items', () => {
    const logs = [{ id: '1', timestamp: '12:00:00', agentName: 'TestAgent', type: 'info', text: 'Hello world' }]
    render(<TerminalConsole logs={logs} connected={true} />)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText(/TestAgent/)).toBeInTheDocument()
  })

  it('shows ONLINE when connected', () => {
    render(<TerminalConsole logs={[]} connected={true} />)
    expect(screen.getByText('ONLINE')).toBeInTheDocument()
  })

  it('shows LINK OFFLINE when disconnected', () => {
    render(<TerminalConsole logs={[]} connected={false} />)
    expect(screen.getByText('LINK OFFLINE')).toBeInTheDocument()
  })
})

describe('StaffPanel', () => {
  it('shows empty state when no agents', () => {
    render(<StaffPanel agentCards={[]} connected={true} selectedAgentId={null} onSelectAgent={() => {}} />)
    expect(screen.getByText('No active agents yet.')).toBeInTheDocument()
  })

  it('renders agent cards', () => {
    const cards = [{
      id: 'agent1', name: 'Hermes-abc123', status: 'working' as const, location: 'desk',
      avatar: null, zoneLabel: 'Desk Area', displayTask: 'Writing code',
      statusLabel: 'Working', isCompact: false, roleLabel: 'Session',
    }]
    render(<StaffPanel agentCards={cards} connected={true} selectedAgentId={null} onSelectAgent={() => {}} />)
    expect(screen.getByText('Hermes-abc123')).toBeInTheDocument()
    expect(screen.getByText('Writing code')).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
  })
})

describe('ZonePanel', () => {
  it('renders zone items', () => {
    const zones = [{
      id: 'desk', name: 'Desk', label: 'Tactical Control', count: 3,
      style: 'open' as const, surface: 'wood', bounds: { x: 1, y: 1, width: 5, height: 5 },
      slots: [], interactionTargets: {}, capacity: 5,
    }]
    render(<ZonePanel visibleZoneSummaries={zones} secondaryZoneSummaries={[]} hiddenZoneSummaries={[]} hiddenOfficeAgentCount={0} />)
    expect(screen.getByText('Tactical Control')).toBeInTheDocument()
    expect(screen.getByText('3 agents')).toBeInTheDocument()
  })
})

describe('Utility functions', () => {
  it('hashCode produces consistent values', () => {
    const h1 = hash('test-agent-1')
    const h2 = hash('test-agent-1')
    expect(h1).toBe(h2)
    expect(typeof h1).toBe('number')
  })
})

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0 }
  return h
}
