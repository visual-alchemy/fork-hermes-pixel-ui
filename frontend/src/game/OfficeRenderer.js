const BASE_TILE_SIZE = 16
const DEFAULT_SCALE = 5
const SCALE_BOOST = 1.1
const MOVE_SPEED = 1.5
const REPLAY_MOVE_SPEED = 3.2
const ROAM_DELAY_MIN = 2400
const ROAM_DELAY_MAX = 5200
const MIN_WORK_VISUAL_MS = 6500

function clampRotation(rotation = 0) {
  return ((rotation % 4) + 4) % 4
}

export class OfficeRenderer {
  constructor(canvas, assetLoader, layout) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.assetLoader = assetLoader
    this.layout = layout
    this.scale = DEFAULT_SCALE
    this.tileSize = (BASE_TILE_SIZE * this.scale) / 2

    this.animationFrame = 0
    this.lastUpdate = Date.now()

    this.agentStates = {}
    this.agentWorkFocus = new Map()
    this.blockedTiles = new Set()

    this.editMode = false
    this.selectedFurnitureType = null
    this.hoverTile = { col: 0, row: 0 }
    this.selectedAgentId = null

    this.offsetX = 0
    this.offsetY = 0
    this.viewportWidth = canvas.clientWidth || canvas.width || 0
    this.viewportHeight = canvas.clientHeight || canvas.height || 0

    this.updateCollisionMap()
  }

  getTheme() {
    const { width, height } = this.layout.dimensions
    return {
      walkwayFloorIndex: 0,
      walkwaySurface: 'hall',
      wallColor: '#20283a',
      trimColor: '#5f7292',
      shadowColor: 'rgba(0, 0, 0, 0.28)',
      officeBounds: { x: 1, y: 1, width: width - 2, height: height - 2 },
      ...(this.layout.theme || {}),
    }
  }

  setEditMode(enabled, type = null) {
    this.editMode = enabled
    this.selectedFurnitureType = type
  }

  resize() {
    const container = this.canvas.parentElement
    if (!container) return

    const previousOffsetX = this.offsetX
    const previousOffsetY = this.offsetY
    const previousTileSize = this.tileSize

    const dpr = window.devicePixelRatio || 1
    const cssWidth = container.clientWidth
    const cssHeight = container.clientHeight
    this.viewportWidth = cssWidth
    this.viewportHeight = cssHeight

    this.canvas.width = Math.round(cssWidth * dpr)
    this.canvas.height = Math.round(cssHeight * dpr)
    this.canvas.style.width = `${cssWidth}px`
    this.canvas.style.height = `${cssHeight}px`
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const preferredScale = DEFAULT_SCALE * SCALE_BOOST
    const availableScaleX = (cssWidth - 72) / (this.layout.dimensions.width * 8)
    const availableScaleY = (cssHeight - 72) / (this.layout.dimensions.height * 8)
    this.scale = Math.max(2.5, Math.min(preferredScale, availableScaleX, availableScaleY))
    this.tileSize = (BASE_TILE_SIZE * this.scale) / 2

    const officeWidth = this.layout.dimensions.width * this.tileSize
    const officeHeight = this.layout.dimensions.height * this.tileSize

    this.offsetX = Math.max(24, (cssWidth - officeWidth) / 2)
    this.offsetY = Math.max(24, (cssHeight - officeHeight) / 2)

    const deltaX = this.offsetX - previousOffsetX
    const deltaY = this.offsetY - previousOffsetY
    const scaleRatio = previousTileSize > 0 ? this.tileSize / previousTileSize : 1

    if (deltaX !== 0 || deltaY !== 0 || scaleRatio !== 1) {
      Object.values(this.agentStates).forEach((state) => {
        state.x = this.offsetX + ((state.x - previousOffsetX) / previousTileSize) * this.tileSize
        state.y = this.offsetY + ((state.y - previousOffsetY) / previousTileSize) * this.tileSize
      })
    }
  }

  getGridPos(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top
    const col = Math.floor((x - this.offsetX) / this.tileSize)
    const row = Math.floor((y - this.offsetY) / this.tileSize)

    return {
      col: Math.max(0, Math.min(this.layout.dimensions.width - 1, col)),
      row: Math.max(0, Math.min(this.layout.dimensions.height - 1, row)),
    }
  }

  tileToScreen(col, row) {
    return {
      x: this.offsetX + col * this.tileSize,
      y: this.offsetY + row * this.tileSize,
    }
  }

  updateCollisionMap() {
    this.blockedTiles.clear()

    if (!this.layout.furniture) return

    this.layout.furniture.forEach((item) => {
      const asset = this.assetLoader.getFurniture((item.type || '').toUpperCase())
      const sprite = this.resolveFurnitureSprite(asset, item)
      if (!sprite) return
      if (sprite.canPlaceOnWalls || sprite.canPlaceOnSurfaces) return

      const startX = item.x !== undefined ? item.x : item.col
      const startY = item.y !== undefined ? item.y : item.row

      for (let dw = 0; dw < sprite.footprintW; dw += 1) {
        for (let dh = 0; dh < sprite.footprintH; dh += 1) {
          this.blockedTiles.add(`${startX + dw},${startY + dh}`)
        }
      }
    })
  }

  findPath(startCol, startRow, endCol, endRow) {
    if (startCol === endCol && startRow === endRow) return []

    const key = (col, row) => `${col},${row}`
    const queue = [{ col: startCol, row: startRow, path: [] }]
    const visited = new Set([key(startCol, startRow)])
    const directions = [
      { col: 0, row: -1 },
      { col: 0, row: 1 },
      { col: -1, row: 0 },
      { col: 1, row: 0 },
    ]

    while (queue.length > 0) {
      const { col, row, path } = queue.shift()

      if (col === endCol && row === endRow) return path

      for (const direction of directions) {
        const nextCol = col + direction.col
        const nextRow = row + direction.row
        const nextKey = key(nextCol, nextRow)

        if (
          nextCol < 0 ||
          nextRow < 0 ||
          nextCol >= this.layout.dimensions.width ||
          nextRow >= this.layout.dimensions.height
        ) {
          continue
        }

        if (visited.has(nextKey)) continue
        if (this.blockedTiles.has(nextKey) && !(nextCol === endCol && nextRow === endRow)) continue

        visited.add(nextKey)
        queue.push({
          col: nextCol,
          row: nextRow,
          path: [...path, { col: nextCol, row: nextRow }],
        })
      }
    }

    return []
  }

  render(agents, layoutState = null) {
    if (!this.assetLoader.isLoaded) return

    const layoutChanged = layoutState && layoutState !== this.layout
    if (layoutState) this.layout = layoutState

    if (layoutChanged) {
      this.updateCollisionMap()
      this.resize()
      Object.values(this.agentStates).forEach((state) => {
        state.path = []
        state.currentTarget = null
        state.finalTarget = null
      })
    }

    const now = Date.now()
    if (now - this.lastUpdate > 180) {
      this.animationFrame = (this.animationFrame + 1) % 3
      this.lastUpdate = now
    }

    this.ctx.clearRect(0, 0, this.viewportWidth, this.viewportHeight)
    this.ctx.imageSmoothingEnabled = false

    this.drawBackdrop()
    this.drawOfficeBase()
    this.drawZones()

    const visualAgents = this.getVisualAgents(agents)

    // Draw error zone overlays before furniture/agents so they appear behind
    this.drawErrorZoneOverlays(visualAgents)

    if (this.editMode) {
      this.drawGrid()
    }

    const renderables = this.collectRenderables(visualAgents)

    if (this.editMode && this.selectedFurnitureType) {
      this.addGhostToRenderables(renderables)
    }

    renderables.sort((left, right) => left.sortY - right.sortY)
    renderables.forEach((item) => item.draw(this.ctx))
    this.drawZoneLabels()
  }

  getVisualAgents(agents) {
    const now = Date.now()
    const activeAgentIds = new Set(agents.map((agent) => agent.id))
    const workLocations = new Set(['desk', 'library', 'meeting'])

    this.agentWorkFocus.forEach((focus, agentId) => {
      if (!activeAgentIds.has(agentId) || now >= focus.until + MIN_WORK_VISUAL_MS) {
        this.agentWorkFocus.delete(agentId)
      }
    })

    return agents.map((agent) => {
      const isWorkFocus =
        agent.status === 'working' &&
        workLocations.has(agent.location) &&
        Boolean(agent.activity)

      if (isWorkFocus) {
        this.agentWorkFocus.set(agent.id, {
          location: agent.location,
          activity: agent.activity,
          task: agent.task,
          replay: Boolean(agent.replay),
          replay_tool: agent.replay_tool,
          until: now + MIN_WORK_VISUAL_MS,
        })
        return agent
      }

      const focus = this.agentWorkFocus.get(agent.id)
      if (!focus || now >= focus.until || agent.status === 'error') {
        if (focus && now >= focus.until) {
          this.agentWorkFocus.delete(agent.id)
        }
        return agent
      }

      return {
        ...agent,
        status: 'working',
        location: focus.location,
        activity: focus.activity,
        task: focus.task || agent.task,
        replay: focus.replay || Boolean(agent.replay),
        replay_tool: focus.replay_tool || agent.replay_tool,
        visual_hold: true,
      }
    })
  }

  drawBackdrop() {
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.viewportHeight)
    gradient.addColorStop(0, '#20283a')
    gradient.addColorStop(1, '#10131c')
    this.ctx.fillStyle = gradient
    this.ctx.fillRect(0, 0, this.viewportWidth, this.viewportHeight)
  }

  drawOfficeBase() {
    const theme = this.getTheme()
    const { officeBounds, wallColor, trimColor, shadowColor, walkwayFloorIndex, walkwaySurface } = theme

    this.fillTileRect(
      officeBounds.x,
      officeBounds.y,
      officeBounds.width,
      officeBounds.height,
      shadowColor,
      0.5,
      0.22,
    )

    this.drawFramedArea(
      officeBounds.x,
      officeBounds.y,
      officeBounds.width,
      officeBounds.height,
      wallColor,
      trimColor,
    )
    this.drawSurfaceArea(officeBounds.x, officeBounds.y, officeBounds.width, officeBounds.height, {
      floorIndex: walkwayFloorIndex,
      surface: walkwaySurface || 'hall',
    })
  }

  drawZones() {
    this.layout.zones.forEach((zone) => {
      if (zone.render === false) return
      if (zone.style === 'room') {
        this.drawRoom(zone)
      } else {
        this.drawOpenZone(zone)
      }
    })
  }

  drawRoom(zone) {
    const theme = this.getTheme()
    const border = this.layout.walls?.thickness ?? 1
    const outerX = zone.bounds.x - border
    const outerY = zone.bounds.y - border
    const outerW = zone.bounds.width + border * 2
    const outerH = zone.bounds.height + border * 2

    this.fillTileRect(outerX, outerY, outerW, outerH, theme.shadowColor, 0.9)
    this.drawWallShell(zone, outerX, outerY, outerW, outerH, border)
    this.drawSurfaceArea(zone.bounds.x, zone.bounds.y, zone.bounds.width, zone.bounds.height, {
      floorIndex: zone.floorIndex ?? theme.walkwayFloorIndex,
      tint: zone.tint,
      surface: zone.surface || 'hall',
    })
  }

  drawOpenZone(zone) {
    const theme = this.getTheme()
    this.drawSurfaceArea(zone.bounds.x, zone.bounds.y, zone.bounds.width, zone.bounds.height, {
      floorIndex: zone.floorIndex ?? theme.walkwayFloorIndex,
      tint: zone.tint,
      surface: zone.surface || 'office',
    })

    if (zone.outline !== false) {
      this.strokeTileRect(zone.bounds.x, zone.bounds.y, zone.bounds.width, zone.bounds.height, zone.accent)
    }
  }

  drawZoneLabels() {
    this.layout.zones.forEach((zone) => {
      if (zone.render === false) return
      if (!this.editMode && !zone.showLabel) return
      this.drawZoneLabel(zone)
    })
  }

  drawWallShell(zone, outerX, outerY, outerW, outerH, border) {
    const theme = this.getTheme()
    const wallColor = zone.wallColor || theme.wallColor
    const trimColor = zone.trimColor || theme.trimColor
    const doors = Array.isArray(zone.doors) ? zone.doors : []

    const horizontalDoors = {
      top: doors.filter((door) => door.side === 'top'),
      bottom: doors.filter((door) => door.side === 'bottom'),
    }

    const verticalDoors = {
      left: doors.filter((door) => door.side === 'left'),
      right: doors.filter((door) => door.side === 'right'),
    }

    this.drawHorizontalWall(
      outerX,
      outerY,
      outerW,
      border,
      horizontalDoors.top,
      zone.bounds.x,
      trimColor,
      wallColor,
    )
    this.drawHorizontalWall(
      outerX,
      outerY + outerH - border,
      outerW,
      border,
      horizontalDoors.bottom,
      zone.bounds.x,
      trimColor,
      wallColor,
    )
    this.drawVerticalWall(
      outerX,
      outerY,
      border,
      outerH,
      verticalDoors.left,
      zone.bounds.y,
      trimColor,
      wallColor,
    )
    this.drawVerticalWall(
      outerX + outerW - border,
      outerY,
      border,
      outerH,
      verticalDoors.right,
      zone.bounds.y,
      trimColor,
      wallColor,
    )
  }

  drawHorizontalWall(x, y, width, height, doors, offset, trimColor, wallColor) {
    const segments = []
    let cursor = x

    const sortedDoors = [...doors].sort((left, right) => left.start - right.start)
    sortedDoors.forEach((door) => {
      const doorStart = offset + door.start

      if (doorStart > cursor) {
        segments.push({ x: cursor, width: doorStart - cursor })
      }

      cursor = doorStart + door.size
    })

    if (cursor < x + width) {
      segments.push({ x: cursor, width: x + width - cursor })
    }

    const screenY = this.offsetY + y * this.tileSize
    segments.forEach((segment) => {
      const screenX = this.offsetX + segment.x * this.tileSize
      this.ctx.fillStyle = wallColor
      this.ctx.fillRect(screenX, screenY, segment.width * this.tileSize, height * this.tileSize)
      this.ctx.fillStyle = trimColor
      this.ctx.fillRect(screenX, screenY, segment.width * this.tileSize, Math.max(2, this.scale))
    })
  }

  drawVerticalWall(x, y, width, height, doors, offset, trimColor, wallColor) {
    const segments = []
    let cursor = y

    const sortedDoors = [...doors].sort((left, right) => left.start - right.start)
    sortedDoors.forEach((door) => {
      const doorStart = offset + door.start
      if (doorStart > cursor) {
        segments.push({ y: cursor, height: doorStart - cursor })
      }
      cursor = doorStart + door.size
    })

    if (cursor < y + height) {
      segments.push({ y: cursor, height: y + height - cursor })
    }

    const screenX = this.offsetX + x * this.tileSize
    segments.forEach((segment) => {
      const screenY = this.offsetY + segment.y * this.tileSize
      this.ctx.fillStyle = wallColor
      this.ctx.fillRect(screenX, screenY, width * this.tileSize, segment.height * this.tileSize)
      this.ctx.fillStyle = trimColor
      this.ctx.fillRect(screenX, screenY, Math.max(2, this.scale), segment.height * this.tileSize)
    })
  }

  drawFramedArea(col, row, width, height, wallColor, trimColor) {
    const { x, y } = this.tileToScreen(col - 1, row - 1)
    this.ctx.fillStyle = wallColor
    this.ctx.fillRect(x, y, (width + 2) * this.tileSize, (height + 2) * this.tileSize)

    this.ctx.strokeStyle = trimColor
    this.ctx.lineWidth = 3
    this.ctx.strokeRect(
      x + this.scale,
      y + this.scale,
      (width + 2) * this.tileSize - this.scale * 2,
      (height + 2) * this.tileSize - this.scale * 2,
    )
  }

  drawSurfaceArea(col, row, width, height, options = {}) {
    const { floorIndex = 0, tint = null, surface = 'hall' } = options
    const palette = this.getSurfacePalette(surface)

    if (!palette) {
      this.drawTiledFloor(col, row, width, height, floorIndex)
      if (tint) this.fillTileRect(col, row, width, height, tint, 0.3, 0)
      return
    }

    const { x, y } = this.tileToScreen(col, row)
    const areaWidth = width * this.tileSize
    const areaHeight = height * this.tileSize

    this.ctx.save()
    this.ctx.fillStyle = palette.base
    this.ctx.fillRect(x, y, areaWidth, areaHeight)

    if (surface === 'wood') {
      for (let drawCol = 0; drawCol < width; drawCol += 1) {
        const tileX = x + drawCol * this.tileSize
        this.ctx.fillStyle = drawCol % 2 === 0 ? palette.base : palette.alt
        this.ctx.fillRect(tileX, y, this.tileSize, areaHeight)
        this.ctx.strokeStyle = palette.line
        this.ctx.lineWidth = 1
        this.ctx.beginPath()
        this.ctx.moveTo(tileX, y)
        this.ctx.lineTo(tileX, y + areaHeight)
        this.ctx.stroke()
      }

      this.ctx.strokeStyle = palette.seam
      for (let drawRow = 0; drawRow < height; drawRow += 2) {
        const seamY = y + drawRow * this.tileSize
        this.ctx.beginPath()
        this.ctx.moveTo(x, seamY)
        this.ctx.lineTo(x + areaWidth, seamY)
        this.ctx.stroke()
      }
    } else if (surface === 'tile-light' || surface === 'hall' || surface === 'tile-blue') {
      for (let drawCol = 0; drawCol < width; drawCol += 1) {
        for (let drawRow = 0; drawRow < height; drawRow += 1) {
          const tileX = x + drawCol * this.tileSize
          const tileY = y + drawRow * this.tileSize
          const shade = (drawCol + drawRow) % 2 === 0 ? palette.base : palette.alt
          this.ctx.fillStyle = shade
          this.ctx.fillRect(tileX, tileY, this.tileSize, this.tileSize)
          this.ctx.strokeStyle = palette.line
          this.ctx.strokeRect(tileX, tileY, this.tileSize, this.tileSize)
        }
      }
    } else if (surface === 'office') {
      for (let drawCol = 0; drawCol < width; drawCol += 1) {
        for (let drawRow = 0; drawRow < height; drawRow += 1) {
          const tileX = x + drawCol * this.tileSize
          const tileY = y + drawRow * this.tileSize
          this.ctx.fillStyle = (drawCol + drawRow) % 3 === 0 ? palette.alt : palette.base
          this.ctx.fillRect(tileX, tileY, this.tileSize, this.tileSize)
        }
      }

      this.ctx.strokeStyle = palette.line
      this.ctx.lineWidth = 1
      for (let drawCol = 0; drawCol <= width; drawCol += 1) {
        const lineX = x + drawCol * this.tileSize
        this.ctx.beginPath()
        this.ctx.moveTo(lineX, y)
        this.ctx.lineTo(lineX, y + areaHeight)
        this.ctx.stroke()
      }
      for (let drawRow = 0; drawRow <= height; drawRow += 1) {
        const lineY = y + drawRow * this.tileSize
        this.ctx.beginPath()
        this.ctx.moveTo(x, lineY)
        this.ctx.lineTo(x + areaWidth, lineY)
        this.ctx.stroke()
      }
    } else if (surface === 'carpet-blue') {
      this.ctx.fillStyle = palette.base
      this.ctx.fillRect(x, y, areaWidth, areaHeight)
      this.ctx.strokeStyle = palette.line
      this.ctx.lineWidth = 1
      for (let drawCol = 0; drawCol < width; drawCol += 1) {
        const lineX = x + drawCol * this.tileSize + this.tileSize / 2
        this.ctx.beginPath()
        this.ctx.moveTo(lineX, y)
        this.ctx.lineTo(lineX, y + areaHeight)
        this.ctx.stroke()
      }
      this.ctx.globalAlpha = 0.12
      this.ctx.fillStyle = palette.alt
      for (let drawRow = 0; drawRow < height; drawRow += 2) {
        this.ctx.fillRect(x, y + drawRow * this.tileSize, areaWidth, this.tileSize)
      }
      this.ctx.globalAlpha = 1
    } else if (surface === 'brick') {
      this.ctx.fillStyle = palette.base
      this.ctx.fillRect(x, y, areaWidth, areaHeight)
      this.ctx.strokeStyle = palette.line
      this.ctx.lineWidth = 1
      for (let drawRow = 0; drawRow < height; drawRow += 1) {
        const lineY = y + drawRow * this.tileSize
        this.ctx.beginPath()
        this.ctx.moveTo(x, lineY)
        this.ctx.lineTo(x + areaWidth, lineY)
        this.ctx.stroke()
        const offset = drawRow % 2 === 0 ? 0 : this.tileSize / 2
        for (let drawCol = 0; drawCol < width; drawCol += 1) {
          const lineX = x + offset + drawCol * this.tileSize
          this.ctx.beginPath()
          this.ctx.moveTo(lineX, lineY)
          this.ctx.lineTo(lineX, Math.min(lineY + this.tileSize, y + areaHeight))
          this.ctx.stroke()
        }
      }
    }

    this.ctx.restore()

    if (tint) {
      this.fillTileRect(col, row, width, height, tint, 0.18, 0)
    }

    this.ctx.save()
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    this.ctx.lineWidth = 2
    this.ctx.strokeRect(x + 1, y + 1, areaWidth - 2, areaHeight - 2)
    this.ctx.restore()
  }

  drawTiledFloor(col, row, width, height, floorIndex = 0) {
    const floor = this.assetLoader.getFloor(floorIndex)
    if (!floor) return

    for (let drawCol = 0; drawCol < width; drawCol += 1) {
      for (let drawRow = 0; drawRow < height; drawRow += 1) {
        const { x, y } = this.tileToScreen(col + drawCol, row + drawRow)
        this.ctx.drawImage(floor, x, y, this.tileSize, this.tileSize)
      }
    }
  }

  getSurfacePalette(surface) {
    const palettes = {
      hall: {
        base: '#b3b7bd',
        alt: '#a3a8af',
        line: 'rgba(255, 255, 255, 0.42)',
      },
      wood: {
        base: '#9d6a3c',
        alt: '#ab7646',
        line: 'rgba(78, 48, 22, 0.55)',
        seam: 'rgba(86, 53, 25, 0.42)',
      },
      'tile-light': {
        base: '#d6d1ca',
        alt: '#e3ddd6',
        line: 'rgba(137, 128, 118, 0.42)',
      },
      office: {
        base: '#c0b7ae',
        alt: '#b6aea4',
        line: 'rgba(255, 255, 255, 0.08)',
      },
      'tile-blue': {
        base: '#b8c4d0',
        alt: '#c5d0db',
        line: 'rgba(87, 100, 116, 0.34)',
      },
      'carpet-blue': {
        base: '#5c7f9d',
        alt: '#6b8cab',
        line: 'rgba(255, 255, 255, 0.08)',
      },
      brick: {
        base: '#83909e',
        alt: '#8d9baa',
        line: 'rgba(77, 85, 94, 0.48)',
      },
    }

    return palettes[surface] || null
  }

  drawZoneLabel(zone) {
    const theme = this.getTheme()
    const anchorCol = zone.labelAnchor?.col ?? zone.bounds.x
    const anchorRow = zone.labelAnchor?.row ?? zone.bounds.y
    const { x, y } = this.tileToScreen(anchorCol, anchorRow)
    const label = zone.label || zone.name || zone.id
    const paddingX = Math.max(11, this.scale * 2)
    const labelHeight = Math.max(30, this.scale * 4.6)

    this.ctx.font = `600 ${Math.max(20, this.scale * 3.35)}px "FS Pixel Sans", monospace`
    this.ctx.textBaseline = 'top'
    const maxWidth = Math.max(88, (zone.labelMaxWidthTiles || 3.4) * this.tileSize)
    const labelWidth = Math.min(
      maxWidth,
      Math.max(96, this.ctx.measureText(label).width + paddingX * 2),
    )
    const align = zone.labelAnchor?.align || 'left'
    const unclampedX =
      align === 'center' ? x - labelWidth / 2 : align === 'right' ? x - labelWidth : x + this.scale + 4
    const unclampedY = y + (zone.labelAnchor?.offsetY ?? 0)
    const officeMinX = this.offsetX + (theme.officeBounds.x - 1) * this.tileSize + 8
    const officeMaxX =
      this.offsetX + (theme.officeBounds.x + theme.officeBounds.width + 1) * this.tileSize - labelWidth - 8
    const officeMinY = this.offsetY + (theme.officeBounds.y - 1) * this.tileSize + 8
    const officeMaxY =
      this.offsetY + (theme.officeBounds.y + theme.officeBounds.height + 1) * this.tileSize - labelHeight - 8
    const chipX = Math.max(officeMinX, Math.min(unclampedX, officeMaxX))
    const chipY = Math.max(officeMinY, Math.min(unclampedY, officeMaxY))

    this.ctx.save()
    this.ctx.fillStyle = 'rgba(245, 237, 219, 0.94)'
    this.ctx.fillRect(chipX, chipY, labelWidth, labelHeight)
    this.ctx.fillStyle = zone.accent || '#7dc3ff'
    this.ctx.fillRect(chipX, chipY, labelWidth, 4)
    this.ctx.strokeStyle = 'rgba(40, 46, 63, 0.62)'
    this.ctx.lineWidth = 2
    this.ctx.strokeRect(chipX + 1, chipY + 1, labelWidth - 2, labelHeight - 2)

    this.ctx.fillStyle = '#1a2130'
    this.ctx.textAlign = 'left'
    this.ctx.textBaseline = 'middle'
    this.ctx.fillText(label, chipX + paddingX, chipY + labelHeight / 2 + 1)
    this.ctx.restore()
  }

  drawGrid() {
    const theme = this.getTheme()
    const { x, y, width, height } = theme.officeBounds

    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    this.ctx.lineWidth = 1

    for (let drawCol = 0; drawCol <= width; drawCol += 1) {
      const screenX = this.offsetX + (x + drawCol) * this.tileSize
      this.ctx.beginPath()
      this.ctx.moveTo(screenX, this.offsetY + y * this.tileSize)
      this.ctx.lineTo(screenX, this.offsetY + (y + height) * this.tileSize)
      this.ctx.stroke()
    }

    for (let drawRow = 0; drawRow <= height; drawRow += 1) {
      const screenY = this.offsetY + (y + drawRow) * this.tileSize
      this.ctx.beginPath()
      this.ctx.moveTo(this.offsetX + x * this.tileSize, screenY)
      this.ctx.lineTo(this.offsetX + (x + width) * this.tileSize, screenY)
      this.ctx.stroke()
    }

    this.ctx.fillStyle = 'rgba(125, 195, 255, 0.28)'
    this.ctx.fillRect(
      this.offsetX + this.hoverTile.col * this.tileSize,
      this.offsetY + this.hoverTile.row * this.tileSize,
      this.tileSize,
      this.tileSize,
    )
  }

  addGhostToRenderables(renderables) {
    const asset = this.assetLoader.getFurniture(this.selectedFurnitureType.toUpperCase())
    const sprite = this.resolveFurnitureSprite(asset, { rotation: 0 })
    if (!sprite) return

    const { x, y } = this.tileToScreen(this.hoverTile.col, this.hoverTile.row)
    const canPlace = this.canPlaceFurnitureAt(
      this.selectedFurnitureType,
      this.hoverTile.col,
      this.hoverTile.row,
    )

    renderables.push({
      sortY: y + 9999,
      draw: (ctx) => {
        ctx.save()
        ctx.globalAlpha = 0.55
        this.drawFurnitureSprite(ctx, sprite, x, y)
        ctx.globalAlpha = 1
        ctx.strokeStyle = canPlace ? '#8ce0a3' : '#ff7979'
        ctx.lineWidth = 2
        ctx.strokeRect(x, y, sprite.footprintW * this.tileSize, sprite.footprintH * this.tileSize)
        ctx.restore()
      },
    })
  }

  canPlaceFurnitureAt(type, col, row) {
    const asset = this.assetLoader.getFurniture(String(type || '').toUpperCase())
    const sprite = this.resolveFurnitureSprite(asset, { rotation: 0 })
    if (!sprite) return false

    if (!this.isFootprintWithinBounds(col, row, sprite.footprintW, sprite.footprintH)) {
      return false
    }

    if (sprite.canPlaceOnSurfaces) {
      const surfacePropAtOrigin = this.layout.furniture.some((item) => {
        const itemX = item.x !== undefined ? item.x : item.col
        const itemY = item.y !== undefined ? item.y : item.row
        if (itemX !== col || itemY !== row) return false

        const itemAsset = this.assetLoader.getFurniture((item.type || '').toUpperCase())
        const itemSprite = this.resolveFurnitureSprite(itemAsset, item)
        return Boolean(itemSprite?.canPlaceOnSurfaces || itemSprite?.canPlaceOnWalls)
      })

      if (surfacePropAtOrigin) return false
      return Boolean(this.findSupportingSurfaceItem({ type, x: col, y: row, rotation: 0 }))
    }

    if (sprite.canPlaceOnWalls) {
      const wallPropAtOrigin = this.layout.furniture.some((item) => {
        const itemX = item.x !== undefined ? item.x : item.col
        const itemY = item.y !== undefined ? item.y : item.row
        if (itemX !== col || itemY !== row) return false

        const itemAsset = this.assetLoader.getFurniture((item.type || '').toUpperCase())
        const itemSprite = this.resolveFurnitureSprite(itemAsset, item)
        return Boolean(itemSprite?.canPlaceOnSurfaces || itemSprite?.canPlaceOnWalls)
      })

      if (wallPropAtOrigin) return false
      return true
    }

    return !this.isFootprintBlocked(col, row, sprite.footprintW, sprite.footprintH)
  }

  isFootprintWithinBounds(startCol, startRow, footprintW, footprintH) {
    return (
      startCol >= 0 &&
      startRow >= 0 &&
      startCol + footprintW <= this.layout.dimensions.width &&
      startRow + footprintH <= this.layout.dimensions.height
    )
  }

  getFurnitureAtTile(col, row) {
    for (let index = this.layout.furniture.length - 1; index >= 0; index -= 1) {
      const item = this.layout.furniture[index]
      const asset = this.assetLoader.getFurniture((item.type || '').toUpperCase())
      const sprite = this.resolveFurnitureSprite(asset, item)
      if (!sprite) continue

      const startX = item.x !== undefined ? item.x : item.col
      const startY = item.y !== undefined ? item.y : item.row
      const endX = startX + sprite.footprintW - 1
      const endY = startY + sprite.footprintH - 1

      if (col >= startX && col <= endX && row >= startY && row <= endY) {
        return item
      }
    }

    return null
  }

  isFootprintBlocked(startCol, startRow, footprintW, footprintH) {
    for (let col = 0; col < footprintW; col += 1) {
      for (let row = 0; row < footprintH; row += 1) {
        const tileCol = startCol + col
        const tileRow = startRow + row

        if (
          tileCol < 0 ||
          tileRow < 0 ||
          tileCol >= this.layout.dimensions.width ||
          tileRow >= this.layout.dimensions.height
        ) {
          return true
        }

        if (this.blockedTiles.has(`${tileCol},${tileRow}`)) {
          return true
        }
      }
    }

    return false
  }

  collectRenderables(agents) {
    const renderables = []
    const zoneIndexes = new Map()
    const movementGroups = new Map()

    agents.forEach((agent) => {
      const zone = this.getAgentZone(agent)
      const activity = this.getAgentActivity(agent)
      const groupKey = this.getMovementGroupKey(agent, zone, activity)
      const group = movementGroups.get(groupKey) || []
      group.push(agent)
      movementGroups.set(groupKey, group)
    })

    movementGroups.forEach((group) => {
      group.sort((left, right) => String(left.id).localeCompare(String(right.id)))
    })

    const movementIndexes = new Map()
    movementGroups.forEach((group, key) => {
      group.forEach((agent, index) => {
        movementIndexes.set(`${key}:${agent.id}`, index)
      })
    })

    const occupiedDeskComputerIds = this.getOccupiedDeskComputerIds(agents, movementIndexes)
    const meetingLaptopActive = this.hasActiveMeeting(agents)

    this.layout.furniture.forEach((item) => {
      const asset = this.assetLoader.getFurniture((item.type || '').toUpperCase())
      const isOccupiedDeskComputer = occupiedDeskComputerIds.has(item.id)
      const isMeetingLaptop = item.id === 'meeting_laptop'
      const isActiveLaptop = isMeetingLaptop && meetingLaptopActive
      const isCoffeeCup = String(item.type || '').toLowerCase() === 'coffee'
      let renderItem = item

      if (isOccupiedDeskComputer || isActiveLaptop) {
        renderItem = { ...item, state: 'on' }
      } else if (isMeetingLaptop) {
        renderItem = { ...item, state: 'off' }
      }

      const sprite = this.resolveFurnitureSprite(asset, renderItem)
      if (!sprite) return

      const placement = this.getFurniturePlacement(renderItem, sprite)

      renderables.push({
        sortY: placement.sortY,
        draw: (ctx) => {
          if (isOccupiedDeskComputer || isActiveLaptop) {
            this.drawComputerGlow(ctx, placement, sprite)
          }
          this.drawFurnitureSprite(ctx, sprite, placement.x, placement.y, placement)
          if (isCoffeeCup) {
            this.drawCoffeeSteam(ctx, placement, sprite)
          }
        },
      })
    })

    const visualAssignments = this.getAgentVisualAssignments(agents)

    agents.forEach((agent) => {
      const zone = this.getAgentZone(agent)
      const zoneKey = zone?.id || '__default__'
      const zoneIndex = zoneIndexes.get(zoneKey) || 0
      zoneIndexes.set(zoneKey, zoneIndex + 1)

      const activity = this.getAgentActivity(agent)
      const movementGroupKey = this.getMovementGroupKey(agent, zone, activity)
      const movementIndex = movementIndexes.get(`${movementGroupKey}:${agent.id}`) ?? zoneIndex
      const state = this.updateAgentMovement(agent, movementIndex)
      const visual = visualAssignments.get(agent.id) || { characterIndex: 0, hueShift: 0 }
      const sprite = this.assetLoader.getCustomCharacter(agent.name, visual.characterIndex, visual.hueShift)
      const frame = state.isMoving ? this.animationFrame : this.animationFrame % 2
      const deskFocus = this.isDeskComputerFocused(agent, state, zone, activity)
      const breakFocus = this.isBreakSeatFocused(agent, state, zone, activity)
      const restFocus = this.isRestSeatFocused(agent, state, zone, activity)
      const meetingFocus = this.isMeetingFocused(agent, state, zone, activity)
      const meetingRole = meetingFocus ? this.getMeetingRole(movementIndex) : null
      const typingPulse = deskFocus && this.animationFrame % 2 === 0 ? 1 : 0

      const agentSortY = restFocus
        ? state.y + this.tileSize * 2 + 1
        : state.y + this.tileSize + 0.5

      renderables.push({
        sortY: agentSortY,
        draw: (ctx) => {
          this.drawAgent(ctx, agent, state.x, state.y, sprite, frame, state.facingRight, {
            deskFocus,
            breakFocus,
            restFocus,
            meetingFocus,
            meetingRole,
            targetPose: state.finalTarget?.pose || null,
            typingPulse,
            activity,
            status: agent.status,
            replay: Boolean(agent.replay),
            isMoving: state.isMoving,
            movementIndex,
          })
        },
      })
    })

    return renderables
  }

  getAgentVisualAssignments(agents) {
    const assignments = new Map()
    const characterCount = Math.max(1, this.assetLoader.characters.length || 1)
    const usedCharacters = new Set()

    ;[...agents]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .forEach((agent, order) => {
        const agentHash = Math.abs(this.hashCode(String(agent.id)))
        let characterIndex = agentHash % characterCount

        if (usedCharacters.size < characterCount) {
          for (let offset = 0; offset < characterCount; offset += 1) {
            const candidate = (characterIndex + offset) % characterCount
            if (usedCharacters.has(candidate)) continue
            characterIndex = candidate
            usedCharacters.add(candidate)
            break
          }
        } else {
          characterIndex = (agentHash + order) % characterCount
        }

        assignments.set(agent.id, {
          characterIndex,
          hueShift: (agentHash + Math.floor(order / characterCount) * 53) % 360,
        })
      })

    return assignments
  }

  getMovementGroupKey(agent, zone = this.getAgentZone(agent), activity = this.getAgentActivity(agent)) {
    if (!zone) return '__default__'

    if ((zone.id === 'desk' || zone.id === 'lab') && activity === 'computer') {
      return `${zone.id}:${activity}`
    }

    return zone.id
  }

  getOccupiedDeskComputerIds(agents, movementIndexes) {
    const occupied = new Set()

    agents.forEach((agent) => {
      const zone = this.getAgentZone(agent)
      const activity = this.getAgentActivity(agent)
      if (!this.isDeskComputerOccupant(agent, zone, activity)) return

      const movementGroupKey = this.getMovementGroupKey(agent, zone, activity)
      const movementIndex = movementIndexes.get(`${movementGroupKey}:${agent.id}`) ?? 0
      const candidates = this.getZoneTargetCandidates(zone, activity)
      const targetTile = this.getAgentTargetTile(agent, movementIndex, zone, candidates)
      const computerItem = this.findNearestFurnitureItem(targetTile, 'pc', 4)

      if (computerItem?.id) {
        occupied.add(computerItem.id)
      }
    })

    return occupied
  }

  isDeskComputerOccupant(agent, zone = this.getAgentZone(agent), activity = this.getAgentActivity(agent)) {
    return Boolean(zone) && (zone.id === 'desk' || zone.id === 'lab') && activity === 'computer'
  }

  hasActiveMeeting(agents) {
    return agents.some((agent) => {
      const zone = this.getAgentZone(agent)
      return zone?.id === 'meeting' && this.getAgentActivity(agent) === 'meeting'
    })
  }

  isDeskComputerWorker(agent, zone = this.getAgentZone(agent), activity = this.getAgentActivity(agent)) {
    return Boolean(zone) && (zone.id === 'desk' || zone.id === 'lab') && activity === 'computer' && agent.status === 'working'
  }

  isDeskComputerFocused(
    agent,
    state,
    zone = this.getAgentZone(agent),
    activity = this.getAgentActivity(agent),
  ) {
    if (!this.isDeskComputerOccupant(agent, zone, activity)) return false
    if (!state) return false

    return !state.isMoving && !state.currentTarget && state.path.length === 0
  }

  isBreakSeatFocused(
    agent,
    state,
    zone = this.getAgentZone(agent),
    activity = this.getAgentActivity(agent),
  ) {
    if (!zone || zone.id !== 'cafe' || activity !== 'break') return false
    if (!state) return false
    if (state.finalTarget?.pose !== 'seated') return false

    return !state.isMoving && !state.currentTarget && state.path.length === 0
  }

  isRestSeatFocused(
    agent,
    state,
    zone = this.getAgentZone(agent),
    activity = this.getAgentActivity(agent),
  ) {
    if (!zone || zone.id !== 'lounge' || activity !== 'rest') return false
    if (!state) return false
    if (state.finalTarget?.pose !== 'resting') return false

    return !state.isMoving && !state.currentTarget && state.path.length === 0
  }

  isMeetingFocused(
    agent,
    state,
    zone = this.getAgentZone(agent),
    activity = this.getAgentActivity(agent),
  ) {
    if (!zone || zone.id !== 'meeting' || activity !== 'meeting') return false
    if (!state) return false

    return !state.isMoving && !state.currentTarget && state.path.length === 0
  }

  getMeetingRole(index = 0) {
    const phase = Math.floor(Date.now() / 1800)
    return (index + phase) % 2 === 0 ? 'talking' : 'listening'
  }

  findNearestFurnitureItem(targetTile, type, maxDistance = Infinity) {
    let bestMatch = null
    let bestDistance = Infinity

    this.layout.furniture.forEach((item) => {
      if (String(item.type || '').toLowerCase() !== type) return

      const itemCol = item.x !== undefined ? item.x : item.col
      const itemRow = item.y !== undefined ? item.y : item.row
      const distance = Math.abs(itemCol - targetTile.col) + Math.abs(itemRow - targetTile.row)

      if (distance > maxDistance || distance >= bestDistance) return

      bestDistance = distance
      bestMatch = item
    })

    return bestMatch
  }

  getFurniturePlacement(item, sprite) {
    const startX = item.x !== undefined ? item.x : item.col
    const startY = item.y !== undefined ? item.y : item.row
    const { x, y } = this.tileToScreen(startX, startY)
    const renderOffsetX = (item.renderOffsetX || 0) * this.tileSize
    const renderOffsetY = (item.renderOffsetY || 0) * this.tileSize

    const basePlacement = {
      x: x + renderOffsetX,
      y: y + renderOffsetY,
      scaleMultiplier: 1,
      sortY: y + renderOffsetY + sprite.footprintH * this.tileSize + 0.1,
    }

    if (!sprite.canPlaceOnSurfaces) {
      return basePlacement
    }

    const support = this.findSupportingSurfaceItem(item)
    if (!support) {
      return basePlacement
    }

    const localCol = startX - support.startX
    const localRow = startY - support.startY
    const supportOrigin = this.tileToScreen(support.startX, support.startY)
    const scaleMultiplier = 0.78
    const drawWidth = sprite.width * (this.scale / 2) * scaleMultiplier
    const drawHeight = sprite.height * (this.scale / 2) * scaleMultiplier
    const insetX = this.getSurfaceInsetX(support, localCol, drawWidth)
    const insetY = this.getSurfaceInsetY(support, localRow)

    return {
      x: supportOrigin.x + localCol * this.tileSize + insetX,
      y: supportOrigin.y + localRow * this.tileSize + insetY,
      scaleMultiplier,
      sortY: supportOrigin.y + support.sprite.footprintH * this.tileSize + 0.25,
    }
  }

  getSurfaceInsetX(support, localCol, drawWidth) {
    const type = String(support.item.type || '').toLowerCase()
    const baseInset = (this.tileSize - drawWidth) / 2

    if (type === 'small_table' || type === 'desk' || type === 'table_front' || type === 'coffee_table') {
      return baseInset
    }

    return baseInset
  }

  getSurfaceInsetY(support, localRow) {
    const type = String(support.item.type || '').toLowerCase()
    const rotation = clampRotation(support.item.rotation || 0)

    if (type === 'small_table' || type === 'desk' || type === 'table_front') {
      if (rotation === 0 || rotation === 2) {
        return this.tileSize * (localRow + 0.52)
      }

      return this.tileSize * (localRow + 0.28)
    }

    if (type === 'coffee_table') {
      return this.tileSize * (localRow + 0.3)
    }

    return this.tileSize * (localRow + 0.18)
  }

  findSupportingSurfaceItem(item) {
    const itemX = item.x !== undefined ? item.x : item.col
    const itemY = item.y !== undefined ? item.y : item.row

    for (const candidate of this.layout.furniture) {
      if (candidate === item) continue

      const asset = this.assetLoader.getFurniture((candidate.type || '').toUpperCase())
      const sprite = this.resolveFurnitureSprite(asset, candidate)
      if (!sprite || sprite.canPlaceOnSurfaces || sprite.canPlaceOnWalls) continue

      const startX = candidate.x !== undefined ? candidate.x : candidate.col
      const startY = candidate.y !== undefined ? candidate.y : candidate.row
      const endX = startX + sprite.footprintW - 1
      const endY = startY + sprite.footprintH - 1

      if (itemX < startX || itemX > endX || itemY < startY || itemY > endY) continue

      return {
        item: candidate,
        sprite,
        startX,
        startY,
      }
    }

    return null
  }

  resolveFurnitureSprite(asset, item = {}) {
    if (!asset?.manifest) return null

    const resolved = this.resolveManifestNode(asset.manifest, asset.images, {
      rotation: clampRotation(item.rotation || 0),
      animationFrame: this.animationFrame,
      state: item.state || 'off',
      mirrored: false,
    })

    if (!resolved) return null

    return {
      ...resolved,
      canPlaceOnWalls: asset.manifest.canPlaceOnWalls,
      canPlaceOnSurfaces: asset.manifest.canPlaceOnSurfaces,
    }
  }

  resolveManifestNode(node, images, options) {
    if (!node) return null

    if (node.type === 'asset') {
      const img = node.file ? images[node.file] : Object.values(images || {})[0]
      return {
        ...node,
        img,
        mirrored: options.mirrored || false,
      }
    }

    if (node.type === 'group') {
      if (node.groupType === 'rotation') {
        const { orientation, mirrored } = this.resolveRotationNode(node, options.rotation)
        const next =
          node.members?.find((member) => member.orientation === orientation) ||
          node.members?.find((member) => member.orientation === 'front') ||
          node.members?.[0]

        return this.resolveManifestNode(next, images, {
          ...options,
          mirrored: options.mirrored || mirrored,
        })
      }

      if (node.groupType === 'state') {
        const next =
          node.members?.find((member) => member.state === options.state) ||
          node.members?.find((member) => member.state === 'off') ||
          node.members?.[0]

        return this.resolveManifestNode(next, images, options)
      }

      if (node.groupType === 'animation') {
        const frames = [...(node.members || [])].sort(
          (left, right) => (left.frame || 0) - (right.frame || 0),
        )
        if (!frames.length) return null
        const next = frames[options.animationFrame % frames.length] || frames[0]
        return this.resolveManifestNode(next, images, options)
      }
    }

    if (node.members?.length) {
      return this.resolveManifestNode(node.members[0], images, options)
    }

    return null
  }

  resolveRotationNode(node, rotation) {
    if (node.rotationScheme === '2-way') {
      if (rotation === 1) return { orientation: 'side', mirrored: false }
      if (rotation === 3) return { orientation: 'side', mirrored: true }
      return { orientation: 'front', mirrored: false }
    }

    if (node.rotationScheme === '3-way-mirror') {
      if (rotation === 1) return { orientation: 'side', mirrored: false }
      if (rotation === 2) return { orientation: 'back', mirrored: false }
      if (rotation === 3) return { orientation: 'side', mirrored: true }
      return { orientation: 'front', mirrored: false }
    }

    return { orientation: 'front', mirrored: false }
  }

  drawFurnitureSprite(ctx, sprite, x, y, options = {}) {
    const scaleMultiplier = options.scaleMultiplier || 1
    const drawWidth = sprite.width * (this.scale / 2) * scaleMultiplier
    const drawHeight = sprite.height * (this.scale / 2) * scaleMultiplier

    if (!sprite?.img) {
      ctx.save()
      ctx.fillStyle = 'rgba(250, 212, 138, 0.9)'
      ctx.fillRect(x, y, Math.max(drawWidth, this.tileSize), Math.max(drawHeight, this.tileSize))
      ctx.strokeStyle = '#332414'
      ctx.lineWidth = 2
      ctx.strokeRect(x, y, Math.max(drawWidth, this.tileSize), Math.max(drawHeight, this.tileSize))
      ctx.restore()
      return
    }

    if (sprite.mirrored) {
      ctx.save()
      ctx.translate(x + drawWidth, y)
      ctx.scale(-1, 1)
      ctx.drawImage(sprite.img, 0, 0, drawWidth, drawHeight)
      ctx.restore()
      return
    }

    ctx.drawImage(sprite.img, x, y, drawWidth, drawHeight)
  }

  drawComputerGlow(ctx, placement, sprite) {
    const scaleMultiplier = placement.scaleMultiplier || 1
    const drawWidth = sprite.width * (this.scale / 2) * scaleMultiplier
    const drawHeight = sprite.height * (this.scale / 2) * scaleMultiplier
    const centerX = placement.x + drawWidth / 2
    const centerY = placement.y + drawHeight * 0.32
    const radius = Math.max(this.tileSize * 0.5, drawWidth * 0.72)

    ctx.save()
    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius)
    glow.addColorStop(0, 'rgba(120, 231, 255, 0.28)')
    glow.addColorStop(0.55, 'rgba(92, 175, 255, 0.14)')
    glow.addColorStop(1, 'rgba(92, 175, 255, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, radius, radius * 0.68, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  drawCoffeeSteam(ctx, placement, sprite) {
    const scaleMultiplier = placement.scaleMultiplier || 1
    const drawWidth = sprite.width * (this.scale / 2) * scaleMultiplier
    const drawHeight = sprite.height * (this.scale / 2) * scaleMultiplier
    const unit = Math.max(1, this.scale * 0.16)
    const centerX = placement.x + drawWidth / 2
    const topY = placement.y + drawHeight * 0.12
    const phase = this.animationFrame % 3

    ctx.save()
    ctx.fillStyle = 'rgba(238, 244, 255, 0.48)'

    for (let index = 0; index < 3; index += 1) {
      const x = centerX + (index - 1) * unit * 2 + (phase === index ? unit : 0)
      const y = topY - (index + phase) * unit * 1.4
      ctx.fillRect(x, y, unit, unit * 1.6)
    }

    ctx.restore()
  }

  hashCode(str) {
    let hash = 0
    for (let index = 0; index < str.length; index += 1) {
      hash = (hash << 5) - hash + str.charCodeAt(index)
      hash |= 0
    }
    return hash
  }

  updateAgentMovement(agent, index) {
    const zone = this.getAgentZone(agent)
    const activity = this.getAgentActivity(agent)
    const candidates = zone ? this.getZoneTargetCandidates(zone, activity) : []
    const anchorTile = this.getAgentTargetTile(agent, index, zone, candidates)
    const targetTile = this.getDesiredAgentTarget(agent, index, zone, candidates, anchorTile)
    const targetX = this.offsetX + targetTile.col * this.tileSize
    const targetY = this.offsetY + targetTile.row * this.tileSize

    if (!this.agentStates[agent.id]) {
      this.agentStates[agent.id] = {
        x: targetX,
        y: targetY,
        path: [],
        currentTarget: null,
        facingRight: true,
        finalTarget: null,
        zoneId: zone?.id || null,
        slotIndex: index,
        activity: activity || null,
        roamStep: 0,
        roamMode: 'anchor',
        nextRoamAt: this.getNextRoamTime(agent),
      }
    }

    const state = this.agentStates[agent.id]
    state.activity = activity || null

    if (
      !state.finalTarget ||
      state.finalTarget.col !== targetTile.col ||
      state.finalTarget.row !== targetTile.row
    ) {
      const startCol = Math.round((state.x - this.offsetX) / this.tileSize)
      const startRow = Math.round((state.y - this.offsetY) / this.tileSize)
      state.path = this.findPath(startCol, startRow, targetTile.col, targetTile.row)
      state.finalTarget = targetTile
      state.currentTarget = state.path.shift()
      if (typeof targetTile.facingRight === 'boolean') {
        state.facingRight = targetTile.facingRight
      }
    }

    state.isMoving = false

    if (state.currentTarget) {
      const targetScreenX = this.offsetX + state.currentTarget.col * this.tileSize
      const targetScreenY = this.offsetY + state.currentTarget.row * this.tileSize
      const deltaX = targetScreenX - state.x
      const deltaY = targetScreenY - state.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      const moveSpeed = agent.replay ? REPLAY_MOVE_SPEED : MOVE_SPEED

      if (distance > moveSpeed) {
        state.x += (deltaX / distance) * moveSpeed
        state.y += (deltaY / distance) * moveSpeed
        state.isMoving = true
        if (Math.abs(deltaX) > 0.1) state.facingRight = deltaX > 0
      } else {
        state.x = targetScreenX
        state.y = targetScreenY
        if (typeof state.currentTarget?.facingRight === 'boolean') {
          state.facingRight = state.currentTarget.facingRight
        }
        state.currentTarget = state.path.shift()
      }
    }

    if (
      !state.isMoving &&
      !state.currentTarget &&
      state.path.length === 0 &&
      typeof state.finalTarget?.facingRight === 'boolean'
    ) {
      state.facingRight = state.finalTarget.facingRight
    }

    return state
  }

  getDesiredAgentTarget(agent, index, zone, candidates, anchorTile) {
    const state = this.agentStates[agent.id]
    if (!state) return anchorTile

    const activity = this.getAgentActivity(agent)
    const zoneChanged =
      state.zoneId !== (zone?.id || null) || state.slotIndex !== index || state.activity !== activity
    if (zoneChanged) {
      state.zoneId = zone?.id || null
      state.slotIndex = index
      state.activity = activity || null
      state.roamStep = 0
      state.roamMode = 'anchor'
      state.nextRoamAt = this.getNextRoamTime(agent)
      return anchorTile
    }

    const currentTarget = state.finalTarget || anchorTile
    if (!this.canAgentRoam(agent, zone)) {
      return anchorTile
    }

    if (state.currentTarget || state.path.length > 0) {
      return currentTarget
    }

    const now = Date.now()
    if (now < (state.nextRoamAt || 0)) {
      return currentTarget
    }

    if (state.roamMode === 'ambient') {
      state.roamMode = 'anchor'
      state.nextRoamAt = now + this.getRoamDelay(agent)
      return anchorTile
    }

    const roamCandidates = this.getZoneRoamCandidates(zone, anchorTile)
    const roamTile = this.getNextRoamTarget(agent, state, roamCandidates, anchorTile)
    state.nextRoamAt = now + this.getRoamDelay(agent)

    if (!roamTile) {
      state.roamMode = 'anchor'
      return anchorTile
    }

    state.roamMode = 'ambient'
    state.roamStep += 1
    return roamTile
  }

  canAgentRoam(agent, zone = null) {
    if (!zone || agent.status === 'error') return false

    const activity = this.getAgentActivity(agent)
    if (this.shouldAnchorAgent(agent, zone, activity)) {
      return false
    }

    return true
  }

  shouldAnchorAgent(agent, zone = null, activity = this.getAgentActivity(agent)) {
    if (agent.replay && agent.status === 'working' && zone?.id && zone.id !== 'cafe') {
      return true
    }

    return Boolean(zone) && (
      (zone.id === 'desk' && activity === 'computer') ||
      (zone.id === 'lab' && activity === 'computer') ||
      (zone.id === 'library' && activity === 'research') ||
      (zone.id === 'cafe' && activity === 'break') ||
      (zone.id === 'lounge' && activity === 'rest') ||
      (zone.id === 'meeting' && activity === 'meeting')
    )
  }

  getRoamDelay(agent) {
    const hash = Math.abs(this.hashCode(`${agent.id}:${agent.status || 'idle'}`))
    let minDelay = ROAM_DELAY_MIN
    let maxDelay = ROAM_DELAY_MAX

    if (agent.status === 'done' || agent.status === 'waiting') {
      minDelay = 1600
      maxDelay = 3200
    } else if (agent.status === 'working') {
      minDelay = 2600
      maxDelay = 4300
    } else if (agent.status === 'idle') {
      minDelay = 2000
      maxDelay = 3600
    }

    return minDelay + (hash % (maxDelay - minDelay + 1))
  }

  getNextRoamTime(agent) {
    return Date.now() + this.getRoamDelay(agent)
  }

  getNextRoamTarget(agent, state, candidates, anchorTile) {
    if (!candidates.length) return anchorTile

    const seed = Math.abs(this.hashCode(String(agent.id)))
    const currentCol = Math.round((state.x - this.offsetX) / this.tileSize)
    const currentRow = Math.round((state.y - this.offsetY) / this.tileSize)
    const currentKey = `${currentCol},${currentRow}`
    const finalKey = state.finalTarget ? `${state.finalTarget.col},${state.finalTarget.row}` : null

    for (let offset = 1; offset <= candidates.length; offset += 1) {
      const candidate = candidates[(seed + state.roamStep * 3 + offset * 2) % candidates.length]
      const key = `${candidate.col},${candidate.row}`
      if (key === currentKey || key === finalKey) continue
      return candidate
    }

    return anchorTile
  }

  getAgentZone(agent) {
    return this.layout.zones.find((item) => item.id === agent.location) || this.layout.zones[0]
  }

  getAgentActivity(agent) {
    return agent.activity || null
  }

  isWalkableTile(col, row) {
    if (
      col < 0 ||
      row < 0 ||
      col >= this.layout.dimensions.width ||
      row >= this.layout.dimensions.height
    ) {
      return false
    }

    return !this.blockedTiles.has(`${col},${row}`)
  }

  getZoneTargetCandidates(zone, activity = null) {
    const candidates = []
    const seen = new Set()
    const margin = zone.style === 'room' ? 1 : 0
    const minCol = zone.bounds.x + margin
    const maxCol = zone.bounds.x + zone.bounds.width - 1 - margin
    const minRow = zone.bounds.y + margin
    const maxRow = zone.bounds.y + zone.bounds.height - 1 - margin
    const centerCol = zone.bounds.x + zone.bounds.width / 2
    const centerRow = zone.bounds.y + zone.bounds.height / 2

    const addCandidate = (target, requireWalkable = true) => {
      const col = target.col
      const row = target.row
      const targetMinCol = target.allowEdge ? zone.bounds.x : minCol
      const targetMaxCol = target.allowEdge ? zone.bounds.x + zone.bounds.width - 1 : maxCol
      const targetMinRow = target.allowEdge ? zone.bounds.y : minRow
      const targetMaxRow = target.allowEdge ? zone.bounds.y + zone.bounds.height - 1 : maxRow
      if (col < targetMinCol || col > targetMaxCol || row < targetMinRow || row > targetMaxRow) return
      if (requireWalkable && !this.isWalkableTile(col, row)) return

      const key = `${col},${row}`
      if (seen.has(key)) return

      seen.add(key)
      candidates.push({ ...target, col, row })
    }

    const interactionTargets = activity ? zone.interactionTargets?.[activity] || [] : []
    interactionTargets.forEach((target) => addCandidate(target, !target.allowBlocked))
    if (candidates.length > 0) {
      return candidates
    }

    zone.slots?.forEach((slot) => addCandidate(slot, true))

    const generated = []
    for (let row = minRow; row <= maxRow; row += 1) {
      for (let col = minCol; col <= maxCol; col += 1) {
        if (!this.isWalkableTile(col, row)) continue
        generated.push({ col, row })
      }
    }

    generated.sort((left, right) => {
      const leftDistance = Math.abs(left.col - centerCol) + Math.abs(left.row - centerRow)
      const rightDistance = Math.abs(right.col - centerCol) + Math.abs(right.row - centerRow)

      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      if (left.row !== right.row) return left.row - right.row
      return left.col - right.col
    })

    generated.forEach((tile) => addCandidate(tile, true))
    return candidates
  }

  getZoneRoamCandidates(zone, anchorTile = null) {
    const candidates = this.getZoneTargetCandidates(zone, null)

    if (!anchorTile) return candidates

    return candidates.filter(
      (candidate) => candidate.col !== anchorTile.col || candidate.row !== anchorTile.row,
    )
  }

  getAgentTargetTile(agent, index, zone = this.getAgentZone(agent), candidates = null) {
    if (!zone) return { col: 0, row: 0 }

    const availableCandidates = candidates || this.getZoneTargetCandidates(zone)
    if (availableCandidates.length > 0) {
      return availableCandidates[index % availableCandidates.length]
    }

    if (Array.isArray(zone.slots) && zone.slots.length > 0) {
      const slot = zone.slots[index % zone.slots.length]
      return { col: slot.col, row: slot.row }
    }

    const margin = zone.style === 'room' ? 1 : 0
    const usableWidth = Math.max(1, zone.bounds.width - margin * 2)
    const usableHeight = Math.max(1, zone.bounds.height - margin * 2)
    const columns = Math.max(1, Math.floor(usableWidth / 2))

    return {
      col: zone.bounds.x + margin + (index % columns) * 2,
      row: zone.bounds.y + margin + (Math.floor(index / columns) % usableHeight),
    }
  }

  drawAgent(ctx, agent, x, y, sprite, frame, facingRight, options = {}) {
    if (!sprite) return

    const {
      deskFocus = false,
      breakFocus = false,
      restFocus = false,
      meetingFocus = false,
      meetingRole = null,
      targetPose = null,
      typingPulse = 0,
      activity = null,
      status = 'idle',
      replay = false,
      isMoving = false,
    } = options
    const spriteScale = this.scale / 2
    const frameColumns = 7
    const frameRows = 3
    const frameWidth = Math.floor(sprite.width / frameColumns)
    const frameHeight = Math.floor(sprite.height / frameRows)
    const pose = this.getAgentPose({
      activity,
      status,
      deskFocus,
      breakFocus,
      restFocus,
      meetingFocus,
      meetingRole,
      targetPose,
      typingPulse,
      isMoving,
      facingRight,
      index: options.movementIndex || 0,
    })
    const poseFrame = pose.frame ?? frame
    const poseRow = Math.max(0, Math.min(frameRows - 1, pose.row || 0))
    const sourceX = (poseFrame % frameColumns) * frameWidth
    const sourceY = poseRow * frameHeight
    const drawWidth = frameWidth * spriteScale
    const drawHeight = frameHeight * spriteScale * (pose.heightScale || 1)
    let drawX = x + (this.tileSize - drawWidth) / 2 + (pose.offsetX || 0)
    let drawY = y + this.tileSize - drawHeight + (pose.offsetY || 0)

    if (deskFocus) {
      drawX += (facingRight ? 1 : -1) * this.tileSize * 0.08
      drawY += this.tileSize * 0.08 + typingPulse
    }

    ctx.save()
    if (!isMoving && (replay || status === 'working')) {
      this.drawAgentActivityPulse(ctx, x, y, drawWidth, activity, replay)
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.24)'
    ctx.beginPath()
    ctx.ellipse(
      drawX + drawWidth / 2,
      y + this.tileSize - 2 * spriteScale,
      Math.max(6 * spriteScale, drawWidth * 0.28),
      Math.max(2.5 * spriteScale, drawHeight * 0.08),
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()

    ctx.save()
    if (!facingRight) {
      ctx.translate(drawX + drawWidth, drawY)
      ctx.scale(-1, 1)
      ctx.drawImage(
        sprite,
        sourceX,
        sourceY,
        frameWidth,
        frameHeight,
        0,
        0,
        drawWidth,
        drawHeight,
      )
    } else {
      ctx.drawImage(
        sprite,
        sourceX,
        sourceY,
        frameWidth,
        frameHeight,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
      )
    }
    ctx.restore()

    if (!isMoving && pose.prop) {
      this.drawAgentPoseProp(ctx, pose.prop, {
        x,
        y,
        drawX,
        drawY,
        drawWidth,
        drawHeight,
        facingRight,
        typingPulse,
        spriteScale,
      })
    }

    if (this.selectedAgentId === agent.id) {
      ctx.save()
      const centerX = drawX + drawWidth / 2
      const centerY = y + this.tileSize - 2 * spriteScale
      const radiusX = Math.max(10 * spriteScale, drawWidth * 0.45)
      const radiusY = Math.max(4 * spriteScale, drawHeight * 0.12)

      const pulse = 1 + 0.12 * Math.sin((Date.now() / 140) % (Math.PI * 2))

      // Glowing targeting ring
      ctx.strokeStyle = '#00b4d8'
      ctx.lineWidth = 2
      ctx.shadowColor = '#00b4d8'
      ctx.shadowBlur = 8 * pulse
      
      // Draw dashed reticle circle
      ctx.beginPath()
      ctx.setLineDash([5, 5])
      ctx.ellipse(centerX, centerY, radiusX * pulse, radiusY * pulse, 0, 0, Math.PI * 2)
      ctx.stroke()

      // Track nodes at key cardinal angles
      ctx.setLineDash([])
      ctx.fillStyle = '#90e0ef'
      ctx.shadowBlur = 10 * pulse

      // Cardinal points
      const points = [
        { x: centerX - radiusX * pulse, y: centerY },
        { x: centerX + radiusX * pulse, y: centerY },
        { x: centerX, y: centerY - radiusY * pulse },
        { x: centerX, y: centerY + radiusY * pulse }
      ]

      points.forEach(pt => {
        ctx.beginPath()
        ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2)
        ctx.fill()
      })

      ctx.restore()
    }

    // --- P0 Feature: Error State Visual Alarm ---
    if (status === 'error') {
      this.drawAgentErrorAlarm(ctx, x, y, drawX, drawY, drawWidth, drawHeight, spriteScale)
    }

    // --- P0 Feature: Agent Name Label ---
    this.drawAgentNameLabel(ctx, agent, drawX, drawY, drawWidth, spriteScale)

    ctx.restore()
  }

  getAgentPose({
    activity,
    status,
    deskFocus,
    breakFocus,
    restFocus,
    meetingFocus,
    meetingRole,
    targetPose,
    typingPulse = 0,
    isMoving = false,
    facingRight = true,
    index = 0,
  }) {
    if (isMoving) {
      return { row: 0 }
    }

    if (deskFocus) {
      return {
        row: 2,
        frame: typingPulse ? 4 : 3,
        prop: 'typing',
      }
    }

    if (meetingFocus) {
      const seated = targetPose === 'seated'
      const talking = meetingRole === 'talking'
      const phase = this.animationFrame % 2
      return {
        row: seated ? 2 : 0,
        // Si habla, alterna frames 0-1 (charla). Si escucha, frame fijo (5 o 6 según índice para variar)
        frame: seated ? (talking ? phase : (5 + (index % 2))) : phase,
        prop: talking ? 'talk' : 'listen',
        offsetX: seated ? (facingRight ? -this.tileSize * 0.05 : this.tileSize * 0.05) : 0,
        offsetY: seated ? this.tileSize * 0.08 : this.tileSize * 0.02,
      }
    }

    if (breakFocus) {
      return {
        row: 2,
        frame: 5 + (this.animationFrame % 2),
        prop: 'coffee',
        offsetY: this.tileSize * 0.08,
      }
    }

    if (restFocus) {
      return {
        row: 2,
        frame: 5 + (this.animationFrame % 2),
        prop: 'coffee',
        offsetX: facingRight ? this.tileSize * 0.14 : -this.tileSize * 0.14,
        offsetY: this.tileSize * 0.08,
      }
    }

    if (status === 'error') {
      return {
        row: 0,
        frame: 0,
        offsetY: this.tileSize * 0.04,
      }
    }

    switch (activity) {
      case 'research':
        // Alternar: unos miran a la estantería (atrás, sin libro), otros leen (frente, con libro)
        const isBackView = (index % 2 === 0)
        return {
          row: isBackView ? 1 : 0,
          frame: this.animationFrame % 2,
          prop: isBackView ? null : 'book',
          // Offset según si está pegado a la estantería o leyendo delante
          offsetY: isBackView ? -this.tileSize * 0.05 : this.tileSize * 0.02,
        }
      case 'meeting':
        return {
          row: 0,
          frame: this.animationFrame % 2,
          prop: 'talk',
          offsetY: this.tileSize * 0.02,
        }
      case 'break':
        return {
          row: 0,
          frame: 0,
          prop: 'coffee',
          offsetY: this.tileSize * 0.06,
        }
      case 'rest':
        return {
          row: 0,
          frame: 0,
          offsetY: this.tileSize * 0.11,
          prop: 'rest',
        }
      default:
        return { row: 0 }
    }
  }

  drawAgentPoseProp(ctx, prop, placement) {
    const {
      x,
      y,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
      facingRight,
      typingPulse,
      spriteScale,
    } = placement
    const side = facingRight ? 1 : -1
    const handX = drawX + drawWidth / 2 + side * drawWidth * 0.28
    const handY = drawY + drawHeight * 0.58

    ctx.save()

    if (prop === 'typing') {
      const keyY = drawY + drawHeight * 0.7
      ctx.fillStyle = typingPulse ? 'rgba(143, 237, 255, 0.9)' : 'rgba(143, 237, 255, 0.45)'
      ctx.fillRect(handX - side * drawWidth * 0.12, keyY, 2 * spriteScale, 1.2 * spriteScale)
      ctx.fillRect(handX + side * drawWidth * 0.03, keyY + 1.5 * spriteScale, 2 * spriteScale, 1.2 * spriteScale)
      ctx.restore()
      return
    }

    if (prop === 'book') {
      const bookW = 4.5 * spriteScale
      const bookH = 3.2 * spriteScale
      const bookX = handX - bookW / 2
      const bookY = handY - bookH / 2

      ctx.fillStyle = '#e6d8ad'
      ctx.fillRect(bookX, bookY, bookW, bookH)
      ctx.fillStyle = '#6b4a36'
      ctx.fillRect(bookX + bookW / 2 - 0.5 * spriteScale, bookY, 1 * spriteScale, bookH)
      ctx.strokeStyle = 'rgba(37, 30, 34, 0.65)'
      ctx.lineWidth = Math.max(1, spriteScale * 0.35)
      ctx.strokeRect(bookX, bookY, bookW, bookH)
      ctx.restore()
      return
    }

    if (prop === 'coffee') {
      const cupX = handX - 1.5 * spriteScale
      const cupY = handY - 1.5 * spriteScale

      ctx.fillStyle = '#f2f0de'
      ctx.fillRect(cupX, cupY, 3 * spriteScale, 3 * spriteScale)
      ctx.fillStyle = '#8c6241'
      ctx.fillRect(cupX + 0.6 * spriteScale, cupY + 0.6 * spriteScale, 1.8 * spriteScale, 1.2 * spriteScale)
      ctx.strokeStyle = 'rgba(37, 30, 34, 0.65)'
      ctx.lineWidth = Math.max(1, spriteScale * 0.3)
      ctx.strokeRect(cupX, cupY, 3 * spriteScale, 3 * spriteScale)
      ctx.restore()
      return
    }

    if (prop === 'talk') {
      const dotY = drawY + drawHeight * 0.42
      const dotX = drawX + drawWidth / 2 + side * drawWidth * 0.34
      ctx.fillStyle = 'rgba(238, 244, 255, 0.85)'
      for (let index = 0; index < 3; index += 1) {
        ctx.beginPath()
        ctx.arc(dotX + side * index * 2.6 * spriteScale, dotY - index * 0.8 * spriteScale, 0.8 * spriteScale, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      return
    }

    if (prop === 'listen') {
      const dotY = drawY + drawHeight * 0.44
      const dotX = drawX + drawWidth / 2 + side * drawWidth * 0.32
      ctx.fillStyle = 'rgba(238, 244, 255, 0.48)'
      ctx.beginPath()
      ctx.arc(dotX, dotY, 0.9 * spriteScale, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      return
    }

    if (prop === 'rest') {
      const centerX = x + this.tileSize / 2
      const baseY = y + this.tileSize - 2 * spriteScale
      ctx.fillStyle = 'rgba(255, 213, 231, 0.32)'
      ctx.fillRect(centerX - 4.8 * spriteScale, baseY - 2 * spriteScale, 9.6 * spriteScale, 1.5 * spriteScale)
      ctx.fillStyle = 'rgba(238, 244, 255, 0.5)'
      ctx.fillRect(centerX + 2.8 * spriteScale, baseY - 4.2 * spriteScale, 2.6 * spriteScale, 1 * spriteScale)
      ctx.fillRect(centerX + 4.2 * spriteScale, baseY - 5.6 * spriteScale, 1.8 * spriteScale, 1 * spriteScale)
      ctx.restore()
      return
    }

    ctx.restore()
  }

  drawAgentActivityPulse(ctx, x, y, drawWidth, activity, replay = false) {
    const color = this.getActivityPulseColor(activity, replay)
    const centerX = x + this.tileSize / 2
    const centerY = y + this.tileSize - 2
    const baseRadius = Math.max(this.tileSize * 0.26, drawWidth * 0.22)
    const pulse = 1 + (this.animationFrame % 3) * 0.12

    ctx.save()
    ctx.globalAlpha = replay ? 0.42 : 0.24
    ctx.strokeStyle = color
    ctx.lineWidth = Math.max(2, this.scale * 0.24)
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, baseRadius * pulse, baseRadius * 0.48 * pulse, 0, 0, Math.PI * 2)
    ctx.stroke()

    ctx.globalAlpha = replay ? 0.18 : 0.1
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, baseRadius * 0.72, baseRadius * 0.28, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  getActivityPulseColor(activity, replay = false) {
    const palette = {
      computer: replay ? 'rgba(116, 224, 255, 1)' : 'rgba(116, 224, 255, 0.9)',
      research: replay ? 'rgba(255, 209, 120, 1)' : 'rgba(255, 209, 120, 0.9)',
      meeting: replay ? 'rgba(163, 189, 255, 1)' : 'rgba(163, 189, 255, 0.9)',
      break: replay ? 'rgba(169, 235, 170, 1)' : 'rgba(169, 235, 170, 0.9)',
      rest: replay ? 'rgba(241, 166, 206, 1)' : 'rgba(241, 166, 206, 0.9)',
    }

    return palette[activity] || (replay ? 'rgba(157, 226, 255, 1)' : 'rgba(157, 226, 255, 0.9)')
  }

  fillTileRect(col, row, width, height, color, alpha = 1, lineAlpha = 0) {
    const { x, y } = this.tileToScreen(col, row)
    this.ctx.save()
    this.ctx.globalAlpha = alpha
    this.ctx.fillStyle = color
    this.ctx.fillRect(x, y, width * this.tileSize, height * this.tileSize)

    if (lineAlpha > 0) {
      this.ctx.globalAlpha = lineAlpha
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
      this.ctx.strokeRect(x, y, width * this.tileSize, height * this.tileSize)
    }

    this.ctx.restore()
  }

  strokeTileRect(col, row, width, height, color = '#7dc3ff') {
    const { x, y } = this.tileToScreen(col, row)
    this.ctx.save()
    this.ctx.strokeStyle = color
    this.ctx.globalAlpha = 0.55
    this.ctx.lineWidth = 2
    this.ctx.strokeRect(x + 1, y + 1, width * this.tileSize - 2, height * this.tileSize - 2)
    this.ctx.restore()
  }

  // =========================================================================
  // P0 Feature: Agent Name Labels
  // =========================================================================

  drawAgentNameLabel(ctx, agent, drawX, drawY, drawWidth, spriteScale) {
    const name = agent.name || agent.id || ''
    const displayName = name.length > 10 ? name.slice(0, 10) : name
    if (!displayName) return

    const fontSize = Math.max(11, Math.round(spriteScale * 6))
    ctx.save()
    ctx.font = `${fontSize}px 'FS Pixel Sans', monospace`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'

    const textWidth = ctx.measureText(displayName).width
    const paddingX = Math.max(5, spriteScale * 2.5)
    const paddingY = Math.max(3, spriteScale * 1.5)
    const pillWidth = textWidth + paddingX * 2
    const pillHeight = fontSize + paddingY * 2
    const pillX = drawX + drawWidth / 2 - pillWidth / 2
    const pillY = drawY - pillHeight - Math.max(3, spriteScale * 2)

    // Dark pill background
    ctx.fillStyle = 'rgba(8, 10, 18, 0.78)'
    ctx.fillRect(pillX, pillY, pillWidth, pillHeight)

    // Thin accent border
    const borderColor = agent.status === 'error'
      ? 'rgba(238, 123, 123, 0.7)'
      : agent.status === 'working'
        ? 'rgba(0, 180, 216, 0.5)'
        : 'rgba(95, 114, 146, 0.45)'
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1
    ctx.strokeRect(pillX, pillY, pillWidth, pillHeight)

    // Name text
    ctx.fillStyle = agent.status === 'error'
      ? '#ee7b7b'
      : '#e8ecf4'
    ctx.fillText(displayName, drawX + drawWidth / 2, pillY + pillHeight - paddingY)

    ctx.restore()
  }

  // =========================================================================
  // P0 Feature: Error State Visual Alarm
  // =========================================================================

  drawAgentErrorAlarm(ctx, x, y, drawX, drawY, drawWidth, drawHeight, spriteScale) {
    const now = Date.now()
    const breathe = 0.5 + 0.5 * Math.sin(now / 300)

    // Red pulsing glow under the agent
    ctx.save()
    const centerX = x + this.tileSize / 2
    const centerY = y + this.tileSize - 2 * spriteScale
    const radius = Math.max(this.tileSize * 0.5, drawWidth * 0.45)

    ctx.globalAlpha = 0.15 + 0.15 * breathe
    const glow = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius * 1.4)
    glow.addColorStop(0, 'rgba(238, 80, 80, 0.7)')
    glow.addColorStop(0.5, 'rgba(238, 80, 80, 0.25)')
    glow.addColorStop(1, 'rgba(238, 80, 80, 0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.ellipse(centerX, centerY, radius * 1.4, radius * 0.7, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // Floating ⚠ warning icon above the agent
    ctx.save()
    const iconSize = Math.max(8, spriteScale * 4.5)
    const bobY = Math.sin(now / 400) * spriteScale * 1.2
    const iconX = drawX + drawWidth / 2
    const iconY = drawY - iconSize - spriteScale * 4 + bobY

    // Warning triangle
    ctx.globalAlpha = 0.7 + 0.3 * breathe
    ctx.fillStyle = '#ee5050'
    ctx.beginPath()
    ctx.moveTo(iconX, iconY - iconSize * 0.6)
    ctx.lineTo(iconX - iconSize * 0.5, iconY + iconSize * 0.4)
    ctx.lineTo(iconX + iconSize * 0.5, iconY + iconSize * 0.4)
    ctx.closePath()
    ctx.fill()

    // Exclamation mark inside triangle
    ctx.fillStyle = '#ffffff'
    const markWidth = Math.max(1, spriteScale * 0.7)
    const markHeight = iconSize * 0.3
    ctx.fillRect(iconX - markWidth / 2, iconY - iconSize * 0.25, markWidth, markHeight)
    ctx.fillRect(iconX - markWidth / 2, iconY + iconSize * 0.15, markWidth, markWidth)

    ctx.restore()
  }

  drawErrorZoneOverlays(agents) {
    // Find zones that contain at least one errored agent
    const errorZoneIds = new Set()
    agents.forEach((agent) => {
      if (agent.status === 'error') {
        errorZoneIds.add(agent.location)
      }
    })

    if (errorZoneIds.size === 0) return

    const now = Date.now()
    const breathe = 0.5 + 0.5 * Math.sin(now / 500)

    this.layout.zones.forEach((zone) => {
      if (zone.render === false) return
      if (!errorZoneIds.has(zone.id)) return

      const { x, y } = this.tileToScreen(zone.bounds.x, zone.bounds.y)
      const width = zone.bounds.width * this.tileSize
      const height = zone.bounds.height * this.tileSize

      this.ctx.save()
      this.ctx.globalAlpha = 0.04 + 0.04 * breathe
      this.ctx.fillStyle = '#ee5050'
      this.ctx.fillRect(x, y, width, height)

      // Pulsing red border
      this.ctx.globalAlpha = 0.2 + 0.15 * breathe
      this.ctx.strokeStyle = '#ee5050'
      this.ctx.lineWidth = 2
      this.ctx.strokeRect(x + 1, y + 1, width - 2, height - 2)
      this.ctx.restore()
    })
  }
}
