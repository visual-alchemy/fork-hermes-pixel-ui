export interface TilePos {
  col: number
  row: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenPos {
  x: number
  y: number
}

export interface LabelAnchor {
  col: number
  row: number
  align?: 'left' | 'center' | 'right'
  offsetY?: number
}

export interface InteractionTarget {
  col: number
  row: number
  facingRight: boolean
  allowBlocked?: boolean
  allowEdge?: boolean
  pose?: 'standing' | 'seated' | 'typing' | 'resting'
}

export interface Door {
  side: 'left' | 'right' | 'top' | 'bottom'
  start: number
  size: number
}

export interface Zone {
  id: string
  name: string
  label: string
  style: 'open' | 'room'
  surface: string
  bounds: Bounds
  slots: TilePos[]
  interactionTargets: Record<string, InteractionTarget[]>
  capacity: number
  labelAnchor?: LabelAnchor
  labelMaxWidthTiles?: number
  showLabel?: boolean
  showInOverview?: boolean
  render?: boolean
  outline?: boolean
  tint?: string
  floorIndex?: number
  wallColor?: string
  trimColor?: string
  accent?: string
  doors?: Door[]
}

export interface FurnitureItem {
  id: string
  type: string
  x: number
  y: number
  col?: number
  row?: number
  rotation: number
  renderOffsetY?: number
  state?: string
}

export interface OfficeTheme {
  walkwayFloorIndex: number
  walkwaySurface: string
  wallColor: string
  trimColor: string
  shadowColor: string
  officeBounds: Bounds
}

export interface Layout {
  id?: string
  name: string
  version: string
  gridSize: number
  dimensions: { width: number; height: number }
  theme: OfficeTheme
  zones: Zone[]
  furniture: FurnitureItem[]
  floors: { color: string; pattern: string }
  walls: { color: string; thickness?: number; pattern?: string }
}

export type AgentStatus = 'idle' | 'working' | 'waiting' | 'done' | 'error'

export interface Agent {
  id: string
  name: string
  status: AgentStatus
  location: string
  task?: string
  activity?: string
  timestamp?: string
  last_update?: string
  replay?: boolean
  replay_tool?: string
  visual_hold?: boolean
}

export interface LayoutPreset {
  id: string
  name: string
  is_default?: boolean
  created_at?: string
}

export interface FurnitureManifest {
  id: string
  rotations?: RotationGroup[]
  states?: StateGroup[]
  animations?: AnimationGroup[]
}

export interface RotationGroup {
  id: string
  frames?: string[]
}

export interface StateGroup {
  id: string
  rotations?: RotationGroup[]
}

export interface AnimationGroup {
  id: string
  frames?: AnimationFrame[]
}

export interface AnimationFrame {
  file?: string
  duration?: number
}

export interface FurnitureSprite {
  file: string
  footprintW: number
  footprintH: number
  renderOffsetX?: number
  renderOffsetY?: number
  sortOffset?: number
  canPlaceOnWalls?: boolean
  canPlaceOnSurfaces?: boolean
}

export interface RenderableItem {
  sortY: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

export type RenderableFurniture = FurnitureItem & {
  _placement?: ScreenPos & { sortY: number }
}

export interface AgentState {
  x: number
  y: number
  path: TilePos[]
  currentTarget: InteractionTarget | null
  finalTarget: InteractionTarget | null
  facingRight: boolean
  pose: string
  destinationZone?: string
  walkTimer: number
  idleTimer: number
  activityTimer: number
  animationFrame: number
  isMoving?: boolean
  zoneId?: string
  slotIndex?: number
  activity?: string
  roamStep?: number
  roamMode?: string
  nextRoamAt?: number
  interRoomTimer?: number
  interRoomFromX?: number
  interRoomFromY?: number
  interRoomToX?: number
  interRoomToY?: number
  breakFocus?: InteractionTarget | null
  deskFocus?: InteractionTarget | null
  meetingFocus?: InteractionTarget | null
  restFocus?: InteractionTarget | null
  meetingRole?: string
  movementIndex?: number
  targetPose?: string
  typingPulse?: number
  heightScale?: number
  status?: string
  activityStatus?: string
  scaleMultiplier?: number
  rotation?: number
  state?: string
}

export type GlobResult<T = string> = Record<string, () => Promise<{ default: T }>>
