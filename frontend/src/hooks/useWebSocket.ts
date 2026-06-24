import { useEffect, useRef, useState, useCallback } from 'react'
import type { Agent, Layout } from '../types'

interface LogFn {
  (agentId: string | null, agentName: string | null, type: string, text: string): void
}

interface UseWebSocketOptions {
  addLog: LogFn
  onLayoutUpdate: (layout: Layout) => void
  onInit: (layout: Layout) => void
}

export function useWebSocket({ addLog, onLayoutUpdate, onInit }: UseWebSocketOptions) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  const connect = useCallback(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsPort = window.location.port ? `:${window.location.port}` : ''
    const ws = new WebSocket(`${wsProtocol}//${window.location.hostname}${wsPort}/ws`)

    ws.onopen = () => {
      setConnected(true)
      addLog(null, 'SYSTEM', 'system', 'WebSocket link established with Batcomputer.')
    }

    ws.onmessage = (event: MessageEvent) => {
      const msg: Record<string, unknown> = JSON.parse(event.data as string)

      if (msg.type === 'init') {
        setAgents((msg.agents as Agent[]) || [])
        if (msg.layout) {
          onInit(msg.layout as Layout)
        }
        addLog(null, 'SYSTEM', 'system', `Retrieved ${((msg.agents as Agent[])?.length || 0)} active agent telemetry links.`)
        return
      }

      if (msg.type === 'layout_updated') {
        if (msg.layout) {
          onLayoutUpdate(msg.layout as Layout)
          addLog(null, 'SYSTEM', 'info', `Layout configuration updated to "${(msg.layout as Layout).name || 'Custom'}"`)
        }
        return
      }

      if (msg.type === 'agent_updated') {
        setAgents((prev) => {
          const updated = msg.agent as Agent
          const found = prev.some((a) => a.id === updated.id)
          const oldAgent = prev.find((a) => a.id === updated.id)

          if (oldAgent) {
            if (oldAgent.status !== updated.status) {
              addLog(updated.id, updated.name, updated.status, `Status: ${updated.status} - "${updated.task || 'Idle'}"`)
            } else if (oldAgent.task !== updated.task && updated.task) {
              addLog(updated.id, updated.name, 'info', `Task: "${updated.task}"`)
            } else if (oldAgent.location !== updated.location) {
              addLog(updated.id, updated.name, 'system', `Relocated to: ${updated.location}`)
            }
          } else {
            addLog(updated.id, updated.name, 'info', `Monitoring started: "${updated.task || 'Idle'}"`)
          }

          if (!found) return [...prev, updated]
          return prev.map((a) => (a.id === updated.id ? updated : a))
        })
        return
      }

      if (msg.type === 'agent_created') {
        setAgents((prev) => {
          const created = msg.agent as Agent
          if (prev.some((a) => a.id === created.id)) return prev
          addLog(created.id, created.name, 'info', `Agent initialized: "${created.task || 'Idle'}"`)
          return [...prev, created]
        })
        return
      }

      if (msg.type === 'agent_removed') {
        setAgents((prev) => {
          const agentId = msg.agent_id as string
          const removed = prev.find((a) => a.id === agentId)
          if (removed) {
            addLog(agentId, removed.name, 'warn', 'Telemetry signal offline.')
          }
          return prev.filter((a) => a.id !== agentId)
        })
      }
    }

    ws.onclose = () => {
      setConnected(false)
      addLog(null, 'SYSTEM', 'error', 'WebSocket telemetry link offline. Reconnecting...')
      window.setTimeout(connect, 2000)
    }

    wsRef.current = ws
  }, [addLog, onLayoutUpdate, onInit])

  useEffect(() => {
    connect()
    return () => wsRef.current?.close()
  }, [connect])

  return { agents, connected }
}
