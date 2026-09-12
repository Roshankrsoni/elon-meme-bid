import * as THREE from 'three'

/**
 * The sponsor stickers are drawn at runtime on a canvas, so the site ships with
 * no branding assets of its own. The visual language follows the reference:
 *
 *   • one flat fill per sticker — acid lime, with orange as the single hero slot
 *   • a rounded "die-cut" square, never perfectly machine-square
 *   • a white dashed ring offset just outside the silhouette
 *   • exactly one mark inside: a hand-drawn glyph, or a code
 *   • limb slots are text bands instead of squares
 */

const INK = '#0d1114'
const LIME = '#dce84f'
const ORANGE = '#f26722'
const DIE_CUT = 'rgba(255, 255, 255, 0.82)'

/** Slot geometry, as a width ÷ height ratio. */
export const SHAPES = {
  square: 1,
  band: 1 / 1.8,
}

export function patchAspect(shape) {
  return SHAPES[shape] ?? SHAPES.square
}

export const BRANDS = [
  { id: 'volt', label: 'Volt', mark: 'glyph', fill: LIME, seed: 23, band: ['VOLT V3', 'VOLT'], handle: '@volt', blurb: 'Every AI video and image model', url: 'volt.run', amount: '$8,000', views: '32,269' },
  { id: 'higgs', label: 'Higsfield', mark: 'code', fill: LIME, seed: 31, band: ['GPT-6 ASTRA', 'HIGSFIELD'], handle: '@higsfield', blurb: 'Generative video for athletes and brands', url: 'higsfield.ai', amount: '$11,400', views: '41,882' },
  { id: 'apex', label: 'Apex 20', mark: 'glyph', fill: ORANGE, seed: 37, band: ['ZERO', 'RANK'], handle: '@apex20', blurb: 'Performance nutrition, nothing else', url: 'apex20.com', amount: '$6,250', views: '18,904' },
  { id: 'hypr', label: 'Hypr', mark: 'code', fill: LIME, seed: 41, band: ['HYPR X1', 'HYPR'], handle: '@hypr', blurb: 'Recovery tools built for race day', url: 'hypr.fit', amount: '$5,100', views: '14,337' },
  { id: 'nova', label: 'Nova', mark: 'glyph', fill: LIME, seed: 53, band: ['NOVA 2.5', 'NOVA'], handle: '@novalabs', blurb: 'Sleep and recovery tracking', url: 'novalabs.io', amount: '$9,750', views: '27,615' },
  { id: 'pulse', label: 'Pulse', mark: 'glyph', fill: LIME, seed: 67, band: ['PULSE KIT', 'PULSE'], handle: '@pulse', blurb: 'Heart-rate kit for endurance sport', url: 'pulse.run', amount: '$7,300', views: '22,048' },
  { id: 'kinet', label: 'Kinet', mark: 'code', fill: LIME, seed: 71, band: ['KINET 01', 'KINET'], handle: '@kinet', blurb: 'Carbon plates, made in Kenya', url: 'kinet.cc', amount: '$12,900', views: '38,410' },
  { id: 'orbit', label: 'Orbit', mark: 'glyph', fill: LIME, seed: 89, band: ['ORBIT WEAR', 'ORBIT'], handle: '@orbitwear', blurb: 'Technical kit for hybrid racing', url: 'orbitwear.com', amount: '$4,600', views: '11,762' },
  { id: 'flux', label: 'Flux', mark: 'code', fill: LIME, seed: 97, band: ['SEEDREAM 5', 'FLUX'], handle: '@fluxenergy', blurb: 'Electrolytes without the sugar', url: 'flux.energy', amount: '$5,900', views: '16,205' },
]

/**
 * The unclaimed-spot placeholder. Kept out of `BRANDS` so it never shows up as
 * a brand you can browse — it is only used when a zone has no sponsor.
 */
export const SLOT = {
  id: 'slot', label: 'Your logo', mark: 'empty', fill: LIME, seed: 11,
  band: ['YOUR BRAND', 'YOUR BRAND'], handle: '@yourbrand', url: 'sponsormybody.com',
  amount: '$1,000', views: '0', blurb: 'This spot is open — claim it with your logo.',
}

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
  return (
    (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255
  )
}

/**
 * Rounded rectangle with a slightly different radius per corner, so the
 * silhouette never looks machine-cut.
 */
function organicRoundRect(ctx, x, y, w, h, radius, random, jitter = 0.06) {
  const r = () => Math.min(radius * (1 - jitter / 2 + random() * jitter), w / 2, h / 2)
  const tl = r()
  const tr = r()
  const br = r()
  const bl = r()

  ctx.beginPath()
  ctx.moveTo(x + tl, y)
  ctx.lineTo(x + w - tr, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr)
  ctx.lineTo(x + w, y + h - br)
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h)
  ctx.lineTo(x + bl, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl)
  ctx.lineTo(x, y + tl)
  ctx.quadraticCurveTo(x, y, x + tl, y)
  ctx.closePath()
}

/** The white die-cut dashes that sit just outside every sticker. */
function dieCut(ctx, x, y, w, h, radius, random) {
  // Sized off the sticker's short side, so the dashes stay visible once the
  // texture is minified onto a body a few centimetres across.
  const unit = Math.min(w, h)
  const gap = unit * 0.045
  ctx.save()
  ctx.setLineDash([unit * 0.07, unit * 0.055])
  ctx.lineWidth = unit * 0.03
  ctx.strokeStyle = DIE_CUT
  organicRoundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, radius + gap, random, 0.04)
  ctx.stroke()
  ctx.restore()
}

/**
 * The hand-drawn mark: enters upper-left with a small hook, sweeps down into an
 * S, closes a loop at the bottom-right, and leaves a short tail to the right.
 */
function drawGlyph(ctx, cx, cy, size, ink) {
  const u = size / 100
  const P = (x, y) => [cx + (x - 50) * u, cy + (y - 50) * u]

  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = 12 * u
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const start = P(26, 30)
  ctx.beginPath()
  ctx.moveTo(start[0], start[1])
  ctx.bezierCurveTo(...P(46, 14), ...P(70, 22), ...P(60, 40))
  ctx.bezierCurveTo(...P(53, 53), ...P(34, 60), ...P(25, 73))
  ctx.bezierCurveTo(...P(17, 86), ...P(32, 93), ...P(45, 87))
  ctx.bezierCurveTo(...P(60, 80), ...P(63, 64), ...P(52, 59))
  ctx.bezierCurveTo(...P(44, 56), ...P(38, 62), ...P(42, 68))
  ctx.stroke()

  // Short tail leaving to the right at mid-height.
  const tail = P(52, 59)
  const tip = P(78, 46)
  ctx.beginPath()
  ctx.moveTo(tail[0], tail[1])
  ctx.lineTo(tip[0], tip[1])
  ctx.stroke()
  ctx.restore()
}

/**
 * A code mark printed straight onto the sticker fill — the fill is the quiet
 * zone, exactly as in the reference.
 */
function drawCode(ctx, x, y, size, modules, ink, fill, seed) {
  const random = mulberry32(seed)
  const cell = size / modules

  const inFinder = (cx, cy) => {
    const corner = (ox, oy) => cx >= ox && cx < ox + 7 && cy >= oy && cy < oy + 7
    return corner(0, 0) || corner(modules - 7, 0) || corner(0, modules - 7)
  }

  ctx.save()
  ctx.fillStyle = ink
  for (let cy = 0; cy < modules; cy += 1) {
    for (let cx = 0; cx < modules; cx += 1) {
      if (inFinder(cx, cy)) continue
      if (random() > 0.5) {
        ctx.fillRect(x + cx * cell, y + cy * cell, cell * 0.94, cell * 0.94)
      }
    }
  }

  // Finder eyes: a bold ring with a solid core.
  for (const [fx, fy] of [[0, 0], [modules - 7, 0], [0, modules - 7]]) {
    const px = x + fx * cell
    const py = y + fy * cell
    const s7 = cell * 7

    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.roundRect(px, py, s7, s7, cell * 1.6)
    ctx.fill()

    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(px + cell, py + cell, s7 - cell * 2, s7 - cell * 2, cell * 0.9)
    ctx.fill()

    ctx.fillStyle = ink
    ctx.beginPath()
    ctx.roundRect(px + cell * 2.3, py + cell * 2.3, s7 - cell * 4.6, s7 - cell * 4.6, cell * 0.5)
    ctx.fill()
  }
  ctx.restore()
}

/** Condensed all-caps, faked by squeezing the glyphs horizontally. */
function condensed(ctx, text, cx, cy, size, ink, squeeze = 0.84) {
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(squeeze, 1)
  ctx.fillStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${size}px Inter, sans-serif`
  ctx.fillText(text, 0, 0)
  ctx.restore()
}

/** Shrinks the font until the string fits, so type never runs off a sticker. */
function fitSize(ctx, text, maxWidth, size, squeeze = 0.84) {
  let current = size
  ctx.font = `700 ${current}px Inter, sans-serif`
  while (current > 6 && ctx.measureText(text).width * squeeze > maxWidth) {
    current -= 2
    ctx.font = `700 ${current}px Inter, sans-serif`
  }
  return current
}

/* ------------------------------------------------------------- stickers --- */

/**
 * Renders one sticker and returns the canvas.
 * `shape` is 'square' (chest, back, forehead) or 'band' (limbs).
 */
export function createPatchCanvas(brand, { size = 512, shape = 'square' } = {}) {
  const w = shape === 'band' ? Math.round(size / 1.8) : size
  const h = size

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  const random = mulberry32(brand.seed)
  const s = size / 512
  const fill = brand.fill ?? LIME
  const ink = luminance(fill) > 0.55 ? INK : '#f4f7f8'

  // Inset so the die-cut ring still fits inside the canvas.
  const inset = size * 0.072
  const bw = w - inset * 2
  const bh = h - inset * 2
  const radius = Math.min(bw, bh) * (shape === 'band' ? 0.14 : 0.22)

  dieCut(ctx, inset, inset, bw, bh, radius, random)

  ctx.fillStyle = fill
  organicRoundRect(ctx, inset, inset, bw, bh, radius, random)
  ctx.fill()

  const cx = w / 2
  const cy = h / 2

  // Everything printed on the sticker is clipped to the sticker.
  const stickerPath = () => organicRoundRect(ctx, inset, inset, bw, bh, radius, random, 0.06)
  ctx.save()
  stickerPath()
  ctx.clip()

  if (brand.mark === 'empty') {
    ctx.save()
    ctx.setLineDash([9 * s, 7 * s])
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 2.4 * s
    const pad = Math.min(bw, bh) * 0.16
    organicRoundRect(ctx, inset + pad, inset + pad, bw - pad * 2, bh - pad * 2, radius * 0.7, random, 0.05)
    ctx.stroke()
    ctx.restore()
    condensed(ctx, 'YOUR', cx, cy - 15 * s, 40 * s, ink)
    condensed(ctx, 'LOGO', cx, cy + 15 * s, 40 * s, ink)
  } else if (shape === 'band') {
    // Two stacked lines — model name over brand — as on the reference's limb
    // stickers.
    const lines = brand.band ?? [brand.label, brand.label]
    const maxW = bw * 0.88
    const upper = fitSize(ctx, lines[0], maxW, bw * 0.46)
    const lower = fitSize(ctx, lines[1], maxW, bw * 0.46)

    condensed(ctx, lines[0], cx, cy - h * 0.17, upper, ink)
    condensed(ctx, lines[1], cx, cy + h * 0.17, lower, ink)
  } else if (brand.mark === 'code') {
    const codeSize = bw * 0.82
    drawCode(ctx, cx - codeSize / 2, cy - codeSize / 2, codeSize, 15, ink, fill, brand.seed)
  } else {
    drawGlyph(ctx, cx, cy, bw * 0.78, ink)
  }

  ctx.restore()

  return canvas
}

/** Canvas → GPU texture. Cached per brand + shape so slider drags are free. */
const textureCache = new Map()

export function patchTexture(brand, shape = 'square') {
  const key = `${brand.id}:${shape}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const texture = new THREE.CanvasTexture(createPatchCanvas(brand, { shape }))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  textureCache.set(key, texture)
  return texture
}

/** Data URL for <img>/background usage in the panel. */
export function patchDataUrl(brand, size = 256, shape = 'square') {
  return createPatchCanvas(brand, { size, shape }).toDataURL('image/png')
}

/**
 * The square brand tile on the sponsor card: the same sticker language, so the
 * card and the body read as one system.
 */
export function logoDataUrl(brand, size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const random = mulberry32(brand.seed)
  const fill = brand.fill ?? LIME
  const ink = luminance(fill) > 0.55 ? INK : '#f4f7f8'
  const s = size / 256

  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, size * 0.24)
  ctx.fill()

  if (brand.mark === 'empty') {
    ctx.save()
    ctx.setLineDash([10 * s, 8 * s])
    ctx.strokeStyle = ink
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 3 * s
    ctx.beginPath()
    ctx.roundRect(size * 0.22, size * 0.22, size * 0.56, size * 0.56, size * 0.12)
    ctx.stroke()
    ctx.restore()
    condensed(ctx, '+', size / 2, size / 2, size * 0.4, ink)
  } else if (brand.mark === 'code') {
    drawCode(ctx, size * 0.14, size * 0.14, size * 0.72, 11, ink, fill, brand.seed)
  } else {
    drawGlyph(ctx, size / 2, size / 2, size * 0.84, ink)
  }

  // A little scuff so the tile is not a flat vector fill.
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(0, 0, size, size, size * 0.24)
  ctx.clip()
  for (let i = 0; i < 90; i += 1) {
    ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)'
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3)
  }
  ctx.restore()

  return canvas.toDataURL('image/png')
}
