import { describe, it, expect } from 'vitest'
import { getOfficeAgents, getStaffAgents, isLikelySubagent, hashCode } from '../agent-utils'
import type { Agent } from '../types'

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: overrides.id || 'test-1',
    name: overrides.name || 'TestAgent',
    status: overrides.status || 'idle',
    location: overrides.location || 'desk',
    task: overrides.task,
    ...overrides,
  }
}

describe('agent-utils', () => {
  describe('hashCode', () => {
    it('produces consistent values', () => {
      expect(hashCode('hello')).toBe(hashCode('hello'))
      expect(hashCode('hello')).not.toBe(hashCode('world'))
    })
  })

  describe('isLikelySubagent', () => {
    it('detects delegate tasks', () => {
      expect(isLikelySubagent(makeAgent({ task: 'delegate to subagent' }))).toBe(true)
    })
    it('detects subagent tasks', () => {
      expect(isLikelySubagent(makeAgent({ task: 'run subagent' }))).toBe(true)
    })
    it('detects worker tasks', () => {
      expect(isLikelySubagent(makeAgent({ task: 'worker process' }))).toBe(true)
    })
    it('returns false for normal tasks', () => {
      expect(isLikelySubagent(makeAgent({ task: 'write code' }))).toBe(false)
    })
  })

  describe('getOfficeAgents', () => {
    it('returns all agents when under limit', () => {
      const agents = [makeAgent({ id: '1' }), makeAgent({ id: '2' })]
      expect(getOfficeAgents(agents)).toHaveLength(2)
    })
    it('caps at MAX 12', () => {
      const agents = Array.from({ length: 20 }, (_, i) => makeAgent({ id: `a-${i}` }))
      expect(getOfficeAgents(agents)).toHaveLength(12)
    })
    it('prioritizes error agents', () => {
      const agents = [
        ...Array.from({ length: 12 }, (_, i) => makeAgent({ id: `idle-${i}`, status: 'idle' })),
        makeAgent({ id: 'error-1', status: 'error' }),
        ...Array.from({ length: 5 }, (_, i) => makeAgent({ id: `extra-${i}`, status: 'idle' })),
      ]
      const result = getOfficeAgents(agents)
      expect(result).toHaveLength(12)
      expect(result.some((a) => a.id === 'error-1')).toBe(true)
    })
  })

  describe('getStaffAgents', () => {
    it('sorts agents by priority', () => {
      const agents = [
        makeAgent({ id: '1', status: 'done' }),
        makeAgent({ id: '2', status: 'working' }),
        makeAgent({ id: '3', status: 'error' }),
      ]
      const result = getStaffAgents(agents)
      expect(result[0].status).toBe('error')
      expect(result[1].status).toBe('working')
      expect(result[2].status).toBe('done')
    })
    it('collapses idle subagents', () => {
      const agent = makeAgent({ id: 'sub1', status: 'idle', task: 'delegate work', replay_tool: 'explorer' })
      expect(isLikelySubagent(agent)).toBe(true)
    })
  })
})
