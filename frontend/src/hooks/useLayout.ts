import { useState, useCallback, useEffect } from 'react'
import type { Layout, LayoutPreset, FurnitureItem } from '../types'

interface LogFn {
  (agentId: string | null, agentName: string | null, type: string, text: string): void
}

interface UseLayoutOptions {
  addLog: LogFn
  initialLayout: Layout
  storageKey: string
}

export function useLayout({ addLog, initialLayout, storageKey }: UseLayoutOptions) {
  const [layout, setLayout] = useState<Layout>(initialLayout)
  const [serverLayout, setServerLayout] = useState<Layout | null>(null)
  const [presets, setPresets] = useState<LayoutPreset[]>([])
  const [newPresetName, setNewPresetName] = useState('')
  const [activePresetId, setActivePresetId] = useState('default')
  const [isSavingPreset, setIsSavingPreset] = useState(false)

  const fetchPresets = useCallback(async () => {
    try {
      const res = await fetch('/api/layouts')
      if (res.ok) {
        const data = await res.json()
        setPresets(data.presets || [])
      }
    } catch (err) {
      console.error('Error fetching presets:', err)
    }
  }, [])

  const handleActivatePreset = useCallback(async (layoutId: string) => {
    try {
      const res = await fetch(`/api/layouts/${layoutId}/activate`, { method: 'POST' })
      if (res.ok) {
        addLog(null, 'SYSTEM', 'info', `Activated layout preset: ${layoutId}`)
      } else {
        const errData = await res.json()
        alert(`Error activating preset: ${errData.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error activating preset:', err)
    }
  }, [addLog])

  const handleSavePreset = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newPresetName.trim()) return

    setIsSavingPreset(true)
    try {
      const res = await fetch('/api/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newPresetName.trim(), layout }),
      })
      if (res.ok) {
        const data = await res.json()
        addLog(null, 'SYSTEM', 'info', `Layout preset "${newPresetName}" saved.`)
        setNewPresetName('')
        await fetchPresets()
        if (data.layout_id) {
          await handleActivatePreset(data.layout_id)
        }
      } else {
        const errData = await res.json()
        alert(`Error saving preset: ${errData.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error saving preset:', err)
      alert('Network error while saving preset.')
    } finally {
      setIsSavingPreset(false)
    }
  }, [newPresetName, layout, fetchPresets, handleActivatePreset, addLog])

  const handleDeletePreset = useCallback(async (layoutId: string, event?: React.MouseEvent) => {
    if (event) event.stopPropagation()
    if (layoutId === 'default') return
    if (!confirm('Are you sure you want to delete this layout preset?')) return

    try {
      const res = await fetch(`/api/layouts/${layoutId}`, { method: 'DELETE' })
      if (res.ok) {
        addLog(null, 'SYSTEM', 'info', `Deleted layout preset: ${layoutId}`)
        await fetchPresets()
      } else {
        const errData = await res.json()
        alert(`Error deleting preset: ${errData.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error deleting preset:', err)
    }
  }, [fetchPresets, addLog])

  const handleSaveCurrentChanges = useCallback(async () => {
    if (activePresetId === 'default') {
      const newName = prompt(
        'The default layout is read-only. Please enter a name to save as a new preset:',
        'My Custom Batcave',
      )
      if (!newName || !newName.trim()) return

      setIsSavingPreset(true)
      try {
        const res = await fetch('/api/layouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim(), layout }),
        })
        if (res.ok) {
          const data = await res.json()
          addLog(null, 'SYSTEM', 'info', `Layout preset "${newName}" saved and activated.`)
          await fetchPresets()
          if (data.layout_id) {
            await handleActivatePreset(data.layout_id)
          }
        } else {
          const errData = await res.json()
          alert(`Error saving preset: ${errData.error || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Error saving preset:', err)
      } finally {
        setIsSavingPreset(false)
      }
      return
    }

    const activePreset = presets.find((p) => p.id === activePresetId)
    const presetName = activePreset ? activePreset.name : 'Custom Layout'

    try {
      const res = await fetch('/api/layouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: presetName, layout, layout_id: activePresetId }),
      })
      if (res.ok) {
        addLog(null, 'SYSTEM', 'info', `Changes saved to layout preset "${presetName}".`)
        await handleActivatePreset(activePresetId)
      } else {
        const errData = await res.json()
        alert(`Error saving layout changes: ${errData.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Error saving changes:', err)
    }
  }, [activePresetId, layout, presets, fetchPresets, handleActivatePreset, addLog])

  const resetLayout = useCallback(async () => {
    if (confirm('Reset layout to the default preset? This will overwrite your current screen layout.')) {
      window.localStorage.removeItem(storageKey)
      await handleActivatePreset('default')
    }
  }, [handleActivatePreset, storageKey])

  const handleAddFurniture = useCallback((type: string, col: number, row: number) => {
    setLayout({
      ...layout,
      furniture: [
        ...layout.furniture,
        { id: `f_${Date.now()}`, type: type.toLowerCase(), x: col, y: row, rotation: 0 },
      ],
    })
  }, [layout])

  const handleRemoveFurniture = useCallback((itemId: string) => {
    setLayout({
      ...layout,
      furniture: layout.furniture.filter((item: FurnitureItem) => item.id !== itemId),
    })
  }, [layout])

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(layout))
    } catch (err) {
      console.warn('No se pudo guardar el layout:', err)
    }
  }, [layout, storageKey])

  const hasUnsavedChanges = serverLayout && JSON.stringify(layout.furniture) !== JSON.stringify(serverLayout.furniture)

  return {
    layout,
    setLayout,
    serverLayout,
    setServerLayout,
    presets,
    activePresetId,
    setActivePresetId,
    newPresetName,
    setNewPresetName,
    isSavingPreset,
    hasUnsavedChanges,
    fetchPresets,
    handleActivatePreset,
    handleSavePreset,
    handleDeletePreset,
    handleSaveCurrentChanges,
    resetLayout,
    handleAddFurniture,
    handleRemoveFurniture,
  }
}
