import * as THREE from 'three'

/**
 * Everything in the brand gallery is drawn at runtime on a canvas, so the site
 * ships with no branding assets of its own. Swap `BRANDS` for real sponsor
 * artwork whenever you like — the detail card reads straight off these fields.
 */

export const BRANDS = [
  { id: 'volt', label: 'Volt', mark: 'VOLT', style: 'qr', color: '#ddf03c', seed: 23, monogram: 'V', handle: '@volt', blurb: 'Every AI video and image model', url: 'volt.run', amount: '$8,000', views: '32,269' },
  { id: 'higgs', label: 'Higsfield', mark: 'HIGS', style: 'qr', color: '#ddf03c', seed: 31, monogram: 'H', handle: '@higsfield', blurb: 'Generative video for athletes and brands', url: 'higsfield.ai', amount: '$11,400', views: '41,882' },
  { id: 'apex', label: '20', mark: '20', style: 'plate', color: '#ddf03c', seed: 37, monogram: '20', handle: '@apex20', blurb: 'Performance nutrition, nothing else', url: 'apex20.com', amount: '$6,250', views: '18,904' },
  { id: 'hypr', label: 'Hypr', mark: 'HYPR', style: 'strip', color: '#3fe9ff', seed: 41, monogram: 'HY', handle: '@hypr', blurb: 'Recovery tools built for race day', url: 'hypr.fit', amount: '$5,100', views: '14,337' },
  { id: 'nova', label: 'Nova', mark: 'NOVA', style: 'qr', color: '#f06ea0', seed: 53, monogram: 'N', handle: '@novalabs', blurb: 'Sleep and recovery tracking', url: 'novalabs.io', amount: '$9,750', views: '27,615' },
  { id: 'pulse', label: 'Pulse', mark: 'PULSE', style: 'strip', color: '#f2f5f7', seed: 67, monogram: 'PL', handle: '@pulse', blurb: 'Heart-rate kit for endurance sport', url: 'pulse.run', amount: '$7,300', views: '22,048' },
  { id: 'kinet', label: 'Kinet', mark: 'KINET', style: 'qr', color: '#3fe9ff', seed: 71, monogram: 'K', handle: '@kinet', blurb: 'Carbon plates, made in Kenya', url: 'kinet.cc', amount: '$12,900', views: '38,410' },
  { id: 'orbit', label: 'Orbit', mark: 'ORBIT', style: 'strip', color: '#f06ea0', seed: 89, monogram: 'OR', handle: '@orbitwear', blurb: 'Technical kit for hybrid racing', url: 'orbitwear.com', amount: '$4,600', views: '11,762' },
  { id: 'flux', label: 'Flux', mark: 'FLUX', style: 'plate', color: '#ffa24b', seed: 97, monogram: 'FX', handle: '@fluxenergy', blurb: 'Electrolytes without the sugar', url: 'flux.energy', amount: '$5,900', views: '16,205' },
]

/**
 * The unclaimed-spot placeholder. Kept out of `BRANDS` so it never shows up as
 * a brand you can browse — it is only used when a zone has no sponsor.
 */
export const SLOT = {
  id: 'slot', label: 'Your logo', style: 'slot', color: '#ddf03c', seed: 11,
  monogram: '+', handle: '@yourbrand', url: 'sponsormybody.com', amount: '$1,000', views: '0',
  blurb: 'This spot is open — claim it with your logo.',
}

export const PATCH_ASPECT = 512 / 360

export function findBrand(id) {
  if (id === SLOT.id) return SLOT
  return BRANDS.find((brand) => brand.id === id) ?? null
}

/* ------------------------------------------------------------ helpers ---- */

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function luminance(hex) {
  const value = parseInt(hex.slice(1), 16)
  const r = (value >> 16) & 255
  const g = (value >> 8) & 255
  const b = value & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Shrinks the font until the string fits, so labels never run off a patch. */
function fitText(ctx, text, maxWidth, { weight = 700, size, family = 'Inter, sans-serif' }) {
  let current = size
  ctx.font = `${weight} ${current}px ${family}`
  while (current > 8 && ctx.measureText(text).width > maxWidth) {
    current -= 2
    ctx.font = `${weight} ${current}px ${family}`
  }
  return current
}

/**
 * Draws a QR-ish matrix: finder squares in three corners, seeded noise inside.
 * The finder cores are drawn in `background`, never erased — punching alpha
 * here would cut holes straight through the patch once it is alpha-tested.
 */
function drawMatrix(ctx, x, y, size, modules, color, seed, background) {
  const random = mulberry32(seed)
  const cell = size / modules
  const inFinder = (cx, cy) => {
    const corner = (ox, oy) => cx >= ox && cx < ox + 3 && cy >= oy && cy < oy + 3
    return corner(0, 0) || corner(modules - 3, 0) || corner(0, modules - 3)
  }

  ctx.fillStyle = color

  for (let cy = 0; cy < modules; cy += 1) {
    for (let cx = 0; cx < modules; cx += 1) {
      if (inFinder(cx, cy)) continue
      if (random() > 0.52) {
        ctx.fillRect(x + cx * cell, y + cy * cell, cell * 0.92, cell * 0.92)
      }
    }
  }

  // Finder patterns: solid block with a lighter core.
  const finders = [
    [0, 0],
    [modules - 3, 0],
    [0, modules - 3],
  ]
  for (const [fx, fy] of finders) {
    const px = x + fx * cell
    const py = y + fy * cell
    const s = cell * 3
    ctx.fillStyle = color
    ctx.fillRect(px, py, s, s)
    ctx.fillStyle = background
    ctx.fillRect(px + cell * 0.72, py + cell * 0.72, s - cell * 1.44, s - cell * 1.44)
    ctx.fillStyle = color
    ctx.fillRect(px + cell * 1.15, py + cell * 1.15, s - cell * 2.3, s - cell * 2.3)
  }
}

/* ------------------------------------------------------------- patch ----- */

/**
 * Renders one patch and returns the canvas.
 * `override.image` (HTMLImageElement) takes over as the artwork when present.
 */
export function createPatchCanvas(patch, { width = 512 } = {}) {
  const w = width
  const h = Math.round(width / PATCH_ASPECT)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  const s = w / 512
  const ink = luminance(patch.color) > 0.55 ? '#0d1b12' : '#0b1116'
  const radius = 30 * s

  // Body.
  ctx.fillStyle = patch.color
  roundRect(ctx, 0, 0, w, h, radius)
  ctx.fill()

  const pad = 30 * s
  // Micro-copy is dropped on gallery thumbnails, where it would only smear.
  const detail = w >= 240

  if (patch.style === 'slot') {
    // Placeholder slot: dashed box + invitation to upload.
    ctx.save()
    ctx.setLineDash([11 * s, 9 * s])
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.55
    ctx.lineWidth = Math.max(1, 2.4 * s)
    roundRect(ctx, pad, h / 2 - 54 * s, w - pad * 2, 108 * s, 14 * s)
    ctx.stroke()
    ctx.restore()

    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const title = 'YOUR LOGO'
    const size = fitText(ctx, title, w - pad * 2 - 28 * s, { size: 44 * s })
    ctx.font = `700 ${size}px Inter, sans-serif`
    ctx.fillText(title, w / 2, h / 2 - (detail ? 12 : 0) * s)

    if (detail) {
      ctx.globalAlpha = 0.62
      ctx.font = `500 ${17 * s}px 'JetBrains Mono', monospace`
      ctx.fillText('UPLOAD TO CLAIM', w / 2, h / 2 + 28 * s)
      ctx.globalAlpha = 1
    }
  } else if (patch.image) {
    // Uploaded brand artwork on a solid field.
    const box = h - pad * 2
    const ratio = patch.image.width / patch.image.height
    let dw = box * ratio
    let dh = box
    const maxW = w - pad * 2
    if (dw > maxW) {
      dw = maxW
      dh = maxW / ratio
    }
    ctx.drawImage(patch.image, (w - dw) / 2, (h - dh) / 2, dw, dh)
  } else if (patch.style === 'plate') {
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = patch.label.toUpperCase()
    const size = fitText(ctx, text, w - pad * 2 - 20 * s, { size: 104 * s })
    ctx.font = `700 ${size}px Inter, sans-serif`
    ctx.fillText(text, w / 2, h / 2)
  } else if (patch.style === 'strip') {
    // Wordmark on a plain field. Rules or bars here read as a frame line once
    // the patch is projected onto a body at a few centimetres.
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = (patch.mark ?? patch.label).toUpperCase()
    const size = fitText(ctx, text, w - pad * 2 - 40 * s, { size: 78 * s })
    ctx.font = `700 ${size}px Inter, sans-serif`
    ctx.fillText(text, w / 2, h / 2)
  } else {
    // 'qr' — code on the left, wordmark on the right. Gallery thumbnails get a
    // smaller code so the wordmark still has room to breathe.
    const qrSize = Math.min(h - pad * 2, (w - pad * 2) * (detail ? 0.52 : 0.4))
    drawMatrix(ctx, pad, (h - qrSize) / 2, qrSize, 9, ink, patch.seed, patch.color)

    const textX = pad + qrSize + 22 * s
    const available = w - pad - textX

    ctx.fillStyle = ink
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    // One wordmark, sized to fill the space — extra micro-copy only turns to
    // mush once the patch is projected onto a body at a few centimetres.
    const mark = (patch.mark ?? patch.label).toUpperCase()
    const size = fitText(ctx, mark, available, { size: 58 * s })
    ctx.font = `700 ${size}px Inter, sans-serif`
    ctx.fillText(mark, textX, h / 2 + size * 0.34)
  }

  // Scuff pass — cheap, breaks up the flat vector fill.
  const random = mulberry32(patch.seed + 7)
  ctx.save()
  roundRect(ctx, 0, 0, w, h, radius)
  ctx.clip()
  for (let i = 0; i < 120; i += 1) {
    const rx = random() * w
    const ry = random() * h
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'
    ctx.fillRect(rx, ry, 1.5 * s + random() * 3 * s, 1.5 * s + random() * 3 * s)
  }
  ctx.restore()

  return canvas
}

/** Canvas → GPU texture. Cached per patch id so rebuilds are free. */
const textureCache = new Map()

export function patchTexture(patch) {
  const key = `${patch.id}:${patch.image ? patch.image.src.length : 0}`
  if (textureCache.has(key)) return textureCache.get(key)

  const texture = new THREE.CanvasTexture(createPatchCanvas(patch))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  textureCache.set(key, texture)
  return texture
}

/** Data URL for <img>/background usage in the HUD. */
export function patchDataUrl(patch, width = 256) {
  return createPatchCanvas(patch, { width }).toDataURL('image/png')
}

/**
 * The square brand tile shown large on the sponsor card. The reference design
 * uses a rounded-square app icon, so this draws the brand's monogram on its
 * colour with a small code mark — no external assets.
 */
const logoCache = new Map()

export function logoDataUrl(brand, size = 256) {
  const key = `${brand.id}:${size}`
  const cached = logoCache.get(key)
  if (cached) return cached

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const ink = luminance(brand.color) > 0.55 ? '#0d1b12' : '#0b1116'
  const radius = size * 0.22

  ctx.fillStyle = brand.color
  roundRect(ctx, 0, 0, size, size, radius)
  ctx.fill()

  if (brand.style === 'slot') {
    ctx.save()
    ctx.setLineDash([size * 0.05, size * 0.04])
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.6
    ctx.lineWidth = size * 0.02
    roundRect(ctx, size * 0.18, size * 0.18, size * 0.64, size * 0.64, size * 0.12)
    ctx.stroke()
    ctx.restore()
  } else {
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const text = (brand.monogram ?? brand.label).toUpperCase()
    const font = Math.min(size * 0.46, (size * 1.4) / Math.max(1, text.length))
    ctx.font = `700 ${font}px Inter, sans-serif`
    ctx.fillText(text, size / 2, size / 2 - size * 0.03)

    // A small code mark in the corner gives the tile the feel of an app icon
    // rather than a plain swatch repeating the name printed under it.
    drawMatrix(ctx, size * 0.68, size * 0.68, size * 0.19, 4, ink, brand.seed, brand.color)
  }

  const url = canvas.toDataURL('image/png')
  logoCache.set(key, url)
  return url
}
