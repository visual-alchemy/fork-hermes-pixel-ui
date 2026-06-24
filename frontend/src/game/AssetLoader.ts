import type { GlobResult } from '../types'

export interface FurnitureAsset {
  manifest: Record<string, unknown>
  images: Record<string, HTMLImageElement>
}

interface SpriteInfo {
  file: string
  footprintW: number
  footprintH: number
  renderOffsetX?: number
  renderOffsetY?: number
  sortOffset?: number
  canPlaceOnWalls?: boolean
  canPlaceOnSurfaces?: boolean
}

export class AssetLoader {
  characters: HTMLImageElement[] = []
  furniture: Record<string, FurnitureAsset> = {}
  floors: HTMLImageElement[] = []
  walls: HTMLImageElement[] = []
  isLoaded = false
  tintCache: Record<string, HTMLCanvasElement> = {}
  avatarCache: Record<string, string> = {}

  async loadAll(): Promise<this> {
    console.log('📦 Iniciando carga de assets...')

    const characterFiles = import.meta.glob(
      '../assets/characters/*.png',
    ) as GlobResult<string>
    this.characters = await this._loadImages(characterFiles)
    console.log(`👤 ${this.characters.length} personajes cargados`)

    const floorFiles = import.meta.glob(
      '../assets/floors/*.png',
    ) as GlobResult<string>
    this.floors = await this._loadImages(floorFiles)
    console.log(`🧱 ${this.floors.length} suelos cargados`)

    const wallFiles = import.meta.glob(
      '../assets/walls/*.png',
    ) as GlobResult<string>
    this.walls = await this._loadImages(wallFiles)
    console.log(`🧱 ${this.walls.length} paredes cargadas`)

    const furnitureManifests = import.meta.glob(
      '../assets/furniture/**/manifest.json',
    ) as GlobResult<Record<string, unknown>>
    const furnitureImages = import.meta.glob(
      '../assets/furniture/**/*.png',
    ) as GlobResult<string>

    for (const path in furnitureManifests) {
      try {
        const manifestModule = await furnitureManifests[path]()
        const manifest = manifestModule.default || manifestModule
        const dir = path.replace('/manifest.json', '')
        const id = (manifest as Record<string, unknown>).id as string
        if (!id) {
          continue
        }

        const images: Record<string, HTMLImageElement> = {}
        for (const imgPath in furnitureImages) {
          if (imgPath.startsWith(dir)) {
            const fileName = imgPath.split('/').pop()!
            const imgUrl = await furnitureImages[imgPath]()
            const url = (imgUrl as { default?: string }).default || (imgUrl as unknown as string)
            const img = await this._loadImage(url)
            images[fileName] = img
          }
        }

        this.furniture[id] = {
          manifest: manifest as Record<string, unknown>,
          images,
        }
      } catch (err) {
        console.error(`❌ Error cargando mueble en ${path}:`, err)
      }
    }
    console.log(`🪑 ${Object.keys(this.furniture).length} muebles cargados`)

    this.isLoaded = true
    this.tintCache = {}
    this.avatarCache = {}
    return this
  }

  getTintedCharacter(index: number, hueShift = 0): HTMLCanvasElement | HTMLImageElement | null {
    const baseImg = this.characters[index % this.characters.length]
    if (!baseImg) return null
    if (hueShift === 0) return baseImg

    const cacheKey = `${index}:${hueShift}`
    if (this.tintCache[cacheKey]) return this.tintCache[cacheKey]

    const canvas = document.createElement('canvas')
    canvas.width = baseImg.width
    canvas.height = baseImg.height
    const ctx = canvas.getContext('2d')!

    ctx.filter = `hue-rotate(${hueShift}deg)`
    ctx.drawImage(baseImg, 0, 0)

    this.tintCache[cacheKey] = canvas
    return canvas
  }

  getCustomCharacter(
    name: string,
    index: number,
    hueShift = 0,
  ): HTMLCanvasElement | HTMLImageElement | null {
    return this.getTintedCharacter(index, hueShift)
  }

  getCharacterAvatar(
    name: string,
    index: number,
    hueShift = 0,
  ): string | null {
    const cacheKey = `${index}:${hueShift}:${(name || '').toLowerCase()}`
    if (this.avatarCache[cacheKey]) return this.avatarCache[cacheKey]

    const sprite = this.getCustomCharacter(name, index, hueShift)
    if (!sprite) return null

    const frameColumns = 7
    const frameWidth = Math.floor(sprite.width / frameColumns)
    const frameHeight = Math.floor(sprite.height / 3)
    const frameIndex = 0
    const sourceX = frameIndex * frameWidth
    const sourceY = 0
    const scale = 3
    const paddingX = 6
    const paddingTop = 4
    const paddingBottom = 2

    const canvas = document.createElement('canvas')
    canvas.width = frameWidth * scale + paddingX * 2
    canvas.height = frameHeight * scale + paddingTop + paddingBottom
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(
      sprite,
      sourceX,
      sourceY,
      frameWidth,
      frameHeight,
      paddingX,
      paddingTop,
      frameWidth * scale,
      frameHeight * scale,
    )

    const dataUrl = canvas.toDataURL()
    this.avatarCache[cacheKey] = dataUrl
    return dataUrl
  }

  async _loadImages(globResult: GlobResult<string>): Promise<HTMLImageElement[]> {
    const images: HTMLImageElement[] = []
    for (const path in globResult) {
      const mod = await globResult[path]()
      const url = (mod as { default?: string }).default || (mod as unknown as string)
      const img = await this._loadImage(url as string)
      images.push(img)
    }
    return images
  }

  _loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(`No se pudo cargar: ${url}`)
      img.src = url
    })
  }

  getCharacter(index: number): HTMLImageElement | undefined {
    return this.characters[index % this.characters.length]
  }

  getFurniture(id: string): FurnitureAsset | undefined {
    return this.furniture[id]
  }

  getFloor(index: number): HTMLImageElement | undefined {
    return this.floors[index % this.floors.length]
  }

  getWall(index: number): HTMLImageElement | undefined {
    return this.walls[index % this.walls.length]
  }

  resolveSprite(asset: FurnitureAsset, item: { rotation?: number; state?: string }): SpriteInfo | null {
    const manifest = asset.manifest as {
      rotations?: Array<{ id: string; frames?: SpriteInfo[] }>
      states?: Array<{ id: string; rotations?: Array<{ id: string; frames?: SpriteInfo[] }> }>
      animations?: Array<{ id: string; frames?: Array<{ file?: string; duration?: number }> }>
    }

    const rot = item.rotation ?? 0
    const rotGroup = manifest.rotations?.[rot]

    if (item.state && manifest.states) {
      const stateGroup = manifest.states.find((s) => s.id === item.state)
      if (stateGroup?.rotations?.[rot]?.frames?.[0]) {
        return stateGroup.rotations[rot].frames[0]
      }
    }

    if (rotGroup?.frames?.[0]) {
      return rotGroup.frames[0]
    }

    return null
  }

  getSpriteImage(asset: FurnitureAsset, sprite: SpriteInfo): HTMLImageElement | null {
    const key = `${sprite.file}.png`
    return asset.images[key] || null
  }
}

export const assetLoader = new AssetLoader()
