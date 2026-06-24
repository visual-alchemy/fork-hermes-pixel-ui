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

  getCustomCharacter(name, index, hueShift = 0) {
    const nameLower = (name || '').toLowerCase();
    const cacheKey = `${index}:${hueShift}:${nameLower}`;
    if (this.tintCache[cacheKey]) return this.tintCache[cacheKey];

    const baseImg = this.characters[index % this.characters.length];
    if (!baseImg) return null;

    if (!nameLower.includes('batman') && !nameLower.includes('alfred') && !nameLower.includes('bruce') && !nameLower.includes('robin') && !nameLower.includes('batgirl')) {
      return this.getTintedCharacter(index, hueShift);
    }

    const canvas = document.createElement('canvas');
    canvas.width = baseImg.width;
    canvas.height = baseImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(baseImg, 0, 0);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];
      const a = data[i+3];

      if (a === 0) continue;

      const isHair = (r > 120 && r < 185 && g > 80 && g < 135 && b > 40 && b < 85);
      const isSuit = (r < 60 && g > 50 && g < 120 && b > 120 && b < 200);
      const isSkin = (r > 200 && r < 250 && g > 130 && g < 185 && b > 90 && b < 145);
      const isWhite = (r > 220 && g > 220 && b > 220);
      const isBlack = (r < 50 && g < 50 && b < 50);

      if (nameLower.includes('batman') || nameLower.includes('bruce')) {
        if (isHair) {
          data[i] = 30; data[i+1] = 35; data[i+2] = 45;
        } else if (isSkin) {
          const pixelY = Math.floor((i / 4) / canvas.width) % 16;
          if (pixelY < 8) {
            data[i] = 30; data[i+1] = 35; data[i+2] = 45;
          }
        } else if (isSuit) {
          data[i] = 55; data[i+1] = 60; data[i+2] = 70;
        } else if (isWhite || isBlack) {
          data[i] = 230; data[i+1] = 180; data[i+2] = 30;
        }
      } else if (nameLower.includes('alfred')) {
        if (isHair) {
          data[i] = 170; data[i+1] = 175; data[i+2] = 180;
        } else if (isSuit) {
          data[i] = 26; data[i+1] = 26; data[i+2] = 26;
        } else if (isBlack) {
          data[i] = 26; data[i+1] = 26; data[i+2] = 26;
        }
      } else if (nameLower.includes('robin')) {
        if (isHair) {
          data[i] = 26; data[i+1] = 26; data[i+2] = 26;
        } else if (isSuit) {
          data[i] = 190; data[i+1] = 30; data[i+2] = 30;
        } else if (isSkin) {
          const pixelY = Math.floor((i / 4) / canvas.width) % 16;
          if (pixelY >= 4 && pixelY <= 7) {
            data[i] = 20; data[i+1] = 20; data[i+2] = 20;
          }
        } else if (isWhite) {
          data[i] = 230; data[i+1] = 180; data[i+2] = 30;
        }
      } else if (nameLower.includes('batgirl')) {
        if (isHair) {
          data[i] = 210; data[i+1] = 90; data[i+2] = 35;
        } else if (isSuit) {
          data[i] = 90; data[i+1] = 50; data[i+2] = 130;
        } else if (isSkin) {
          const pixelY = Math.floor((i / 4) / canvas.width) % 16;
          if (pixelY < 8) {
            data[i] = 20; data[i+1] = 20; data[i+2] = 20;
          }
        } else if (isWhite) {
          data[i] = 230; data[i+1] = 180; data[i+2] = 30;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    this.tintCache[cacheKey] = canvas;
    return canvas;
  }

  getCharacterAvatar(name, index, hueShift = 0) {
    const cacheKey = `${index}:${hueShift}:${(name || '').toLowerCase()}`;
    if (this.avatarCache[cacheKey]) return this.avatarCache[cacheKey];

    const sprite = this.getCustomCharacter(name, index, hueShift);
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
