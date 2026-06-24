import type { Agent, AgentStatus } from './types'

const MAX_OFFICE_AGENTS = 12
const ACTIVE_AGENT_STATUSES = new Set<AgentStatus>(['working', 'waiting', 'error'])
const STAFF_COLLAPSE_STATUSES = new Set<AgentStatus>(['idle', 'done'])

export function hashCode(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) { hash = (hash << 5) - hash + value.charCodeAt(i); hash |= 0 }
  return hash
}

export function isLikelySubagent(agent: Agent): boolean {
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

function getAgentTime(agent: Agent, field = 'last_update'): number {
  const val = (agent as unknown as Record<string, unknown>)[field]
  return Number.isNaN(Date.parse(typeof val === 'string' ? val : '')) ? 0 : Date.parse(typeof val === 'string' ? val : '')
}

export function getOfficeAgents(agents: Agent[]): Agent[] {
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

export function getStaffAgents(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aC = STAFF_COLLAPSE_STATUSES.has(a.status) && isLikelySubagent(a) ? 1 : 0
    const bC = STAFF_COLLAPSE_STATUSES.has(b.status) && isLikelySubagent(b) ? 1 : 0
    if (aC !== bC) return aC - bC
    const aP = getPriority(a), bP = getPriority(b)
    if (aP !== bP) return bP - aP
    return getAgentTime(b) - getAgentTime(a)
  })
}
