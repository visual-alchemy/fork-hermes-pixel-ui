import type { LayoutPreset } from '../types'

interface SceneEditorProps {
  activePresetId: string
  presets: LayoutPreset[]
  hasUnsavedChanges: boolean
  isSavingPreset: boolean
  newPresetName: string
  selectedType: string
  furnitureTypes: string[]
  furnitureLabels: Record<string, string>
  onActivatePreset: (id: string) => void
  onDeletePreset: (id: string) => void
  onSaveCurrentChanges: () => void
  onSetNewPresetName: (name: string) => void
  onSavePreset: (e?: React.FormEvent) => void
  onSelectType: (type: string) => void
  onReset: () => void
}

export function SceneEditor({
  activePresetId,
  presets,
  hasUnsavedChanges,
  isSavingPreset,
  newPresetName,
  selectedType,
  furnitureTypes,
  furnitureLabels,
  onActivatePreset,
  onDeletePreset,
  onSaveCurrentChanges,
  onSetNewPresetName,
  onSavePreset,
  onSelectType,
  onReset,
}: SceneEditorProps) {
  return (
    <aside className="editor-sidebar pixel-panel">
      <div className="panel-heading">
        <span className="eyebrow">Scene Editor</span>
        <h2>Layout Presets</h2>
      </div>

      <div className="preset-selector-section">
        <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <select
            className="preset-select"
            value={activePresetId}
            onChange={(e) => { void onActivatePreset(e.target.value) }}
          >
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} {preset.is_default ? '★' : ''}
              </option>
            ))}
          </select>
          {activePresetId !== 'default' && (
            <button
              className="toolbar-button preset-btn-small preset-btn-delete"
              onClick={() => { void onDeletePreset(activePresetId) }}
              title="Delete Preset"
            >
              Delete
            </button>
          )}
        </div>

        <div className="preset-button-row">
          <button
            className={`toolbar-button preset-btn-small ${hasUnsavedChanges ? 'preset-btn-unsaved' : ''}`}
            style={{
              flex: 1,
              borderColor: hasUnsavedChanges ? '#ff9f1c' : 'var(--line-soft)',
              color: hasUnsavedChanges ? '#ffe0b2' : 'var(--text-main)',
              background: hasUnsavedChanges ? 'rgba(255, 159, 28, 0.12)' : 'rgba(16, 21, 33, 0.7)',
            }}
            onClick={() => { void onSaveCurrentChanges() }}
          >
            {activePresetId === 'default' ? 'Save as New' : 'Save Changes'}
            {hasUnsavedChanges && <span className="unsaved-indicator" style={{ marginLeft: '6px' }} />}
          </button>
        </div>

        <form onSubmit={(e) => { void onSavePreset(e) }} style={{ display: 'flex', gap: '8px', width: '100%' }}>
          <input
            type="text"
            className="preset-input"
            placeholder="New preset name..."
            value={newPresetName}
            onChange={(e) => onSetNewPresetName(e.target.value)}
          />
          <button
            type="submit"
            className="toolbar-button preset-btn-small"
            disabled={isSavingPreset || !newPresetName.trim()}
          >
            Save
          </button>
        </form>
      </div>

      <div className="panel-heading" style={{ marginTop: '8px' }}>
        <h2>Furniture</h2>
      </div>

      <div className="furniture-grid">
        {furnitureTypes.map((type) => (
          <button
            key={type}
            className={`furniture-button ${selectedType === type ? 'is-selected' : ''}`}
            onClick={() => onSelectType(type)}
          >
            {furnitureLabels[type] || type.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <p className="editor-hint">Shift or right-click to remove a piece.</p>
      <button className="toolbar-button editor-reset-button" onClick={() => { void onReset() }}>
        Reset to Baseline
      </button>
    </aside>
  )
}
