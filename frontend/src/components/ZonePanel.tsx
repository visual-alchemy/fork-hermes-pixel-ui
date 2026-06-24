import type { Zone } from '../types'

interface ZoneSummary extends Zone {
  count: number
  accent?: string
  color?: string
}

interface ZonePanelProps {
  visibleZoneSummaries: ZoneSummary[]
  secondaryZoneSummaries: ZoneSummary[]
  hiddenZoneSummaries: ZoneSummary[]
  hiddenOfficeAgentCount: number
}

export function ZonePanel({
  visibleZoneSummaries,
  secondaryZoneSummaries,
  hiddenZoneSummaries,
  hiddenOfficeAgentCount,
}: ZonePanelProps) {
  return (
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
  )
}
