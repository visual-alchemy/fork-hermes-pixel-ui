/**
 * AssetLoader.js
 * Carga dinámicamente personajes, muebles y suelos para el Pixel UI
 */

export class AssetLoader {
  constructor() {
    this.characters = [];
    this.furniture = {};
    this.floors = [];
    this.walls = [];
    this.isLoaded = false;
    this.tintCache = {};
    this.avatarCache = {};
  }

  async loadAll() {
    console.log('📦 Iniciando carga de assets...');

    // 1. Cargar Personajes
    // Usamos glob de Vite para encontrar todos los personajes
    const characterFiles = import.meta.glob('../assets/characters/*.png');
    this.characters = await this._loadImages(characterFiles);
    console.log(`👤 ${this.characters.length} personajes cargados`);

    // 2. Cargar Suelos
    const floorFiles = import.meta.glob('../assets/floors/*.png');
    this.floors = await this._loadImages(floorFiles);
    console.log(`🧱 ${this.floors.length} suelos cargados`);

    // 3. Cargar Paredes
    const wallFiles = import.meta.glob('../assets/walls/*.png');
    this.walls = await this._loadImages(wallFiles);
    console.log(`🧱 ${this.walls.length} paredes cargadas`);

    // 4. Cargar Muebles y sus Manifests
    // Esto es un poco más complejo porque cada mueble tiene un JSON y uno o más PNGs
    const furnitureManifests = import.meta.glob('../assets/furniture/**/manifest.json');
    const furnitureImages = import.meta.glob('../assets/furniture/**/*.png');

    for (const path in furnitureManifests) {
      try {
        const manifestModule = await furnitureManifests[path]();
        const manifest = manifestModule.default || manifestModule;
        const dir = path.replace('/manifest.json', '');
        const id = manifest.id;
        if (!id) {
          continue;
        }

        // Buscar imágenes asociadas a este mueble
        const images = {};
        for (const imgPath in furnitureImages) {
          if (imgPath.startsWith(dir)) {
            const fileName = imgPath.split('/').pop();
            const imgUrl = await furnitureImages[imgPath]();
            const img = await this._loadImage(imgUrl.default || imgUrl);
            images[fileName] = img;
          }
        }

        this.furniture[id] = {
          manifest,
          images
        };
      } catch (err) {
        console.error(`❌ Error cargando mueble en ${path}:`, err);
      }
    }
    console.log(`🪑 ${Object.keys(this.furniture).length} muebles cargados`);

    this.isLoaded = true;
    this.tintCache = {}; // Cache para sprites con hue-shift
    this.avatarCache = {};
    return this;
  }

  getTintedCharacter(index, hueShift = 0) {
    const baseImg = this.characters[index % this.characters.length];
    if (!baseImg) return null;
    if (hueShift === 0) return baseImg;

    const cacheKey = `${index}:${hueShift}`;
    if (this.tintCache[cacheKey]) return this.tintCache[cacheKey];

    // Crear canvas off-screen para aplicar el tinte
    const canvas = document.createElement('canvas');
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    const ctx = canvas.getContext('2d');

    // Aplicar filtro de rotación de color (hue-rotate)
    ctx.filter = `hue-rotate(${hueShift}deg)`;
    ctx.drawImage(baseImg, 0, 0);
    
    // Guardar en caché
    this.tintCache[cacheKey] = canvas;
    return canvas;
  }

  getCharacterAvatar(index, hueShift = 0) {
    const cacheKey = `${index}:${hueShift}`;
    if (this.avatarCache[cacheKey]) return this.avatarCache[cacheKey];

    const sprite = this.getTintedCharacter(index, hueShift);
    if (!sprite) return null;

    const frameColumns = 7;
    const frameWidth = Math.floor(sprite.width / frameColumns);
    const frameHeight = Math.floor(sprite.height / 3);
    const frameIndex = 0;
    const sourceX = frameIndex * frameWidth;
    const sourceY = 0;
    const scale = 3;
    const paddingX = 6;
    const paddingTop = 4;
    const paddingBottom = 2;

    const canvas = document.createElement('canvas');
    canvas.width = frameWidth * scale + paddingX * 2;
    canvas.height = frameHeight * scale + paddingTop + paddingBottom;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
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
    );

    const dataUrl = canvas.toDataURL();
    this.avatarCache[cacheKey] = dataUrl;
    return dataUrl;
  }

  async _loadImages(globResult) {
    const images = [];
    for (const path in globResult) {
      const mod = await globResult[path]();
      const url = mod.default || mod;
      const img = await this._loadImage(url);
      images.push(img);
    }
    return images;
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(`No se pudo cargar: ${url}`);
      img.src = url;
    });
  }

  getCharacter(index) {
    return this.characters[index % this.characters.length];
  }

  getFurniture(id) {
    return this.furniture[id];
  }

  getFloor(index) {
    return this.floors[index % this.floors.length];
  }

  getWall(index) {
    return this.walls[index % this.walls.length];
  }
}

export const assetLoader = new AssetLoader();
