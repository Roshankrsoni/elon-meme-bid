import * as THREE from 'three'

/**
 * The sponsor stickers are drawn at runtime on a canvas, so the site ships with
 * no branding assets of its own. The visual language follows the reference:
 *
 *   • one flat fill per sticker — acid lime, with orange as the single hero slot
 *   • a rounded "die-cut" square, never perfectly machine-square
 *   • a fine white dashed ring hugging the silhouette, the only edge the sticker
 *     gets besides its fill
 *   • exactly one mark inside: a hand-drawn glyph, or a code
 *   • limb slots carry no squares: they are straps split into two columns, the
 *     brand reading up one and the model up the other
 */

const INK = '#0d1114'
const PAPER = '#f2f5f3'
const LIME = '#dce84f'
const ORANGE = '#f26722'
const DIE_CUT = 'rgba(255, 255, 255, 0.9)'

/** Slot geometry, as a width ÷ height ratio. */
export const SHAPES = {
  square: 1,
  /** Landscape slot for the back — a bumper-sticker proportion. */
  wide: 2.6,
  /** Portrait limb strap: brand and model stacked as two columns of type. */
  band: 1 / 2.7,
}

export function patchAspect(shape) {
  return SHAPES[shape] ?? SHAPES.square
}

/** Baked-in catalogue = offline fallback. `replaceBrands` swaps in the DB rows. */
export const BRANDS = [
  { id: 'volt', label: 'Volt', mark: 'glyph', fill: LIME, seed: 23, band: ['VOLT V3', 'VOLT'], handle: '@volt', blurb: 'Every AI video and image model', url: 'volt.run', amount: '$8,000', views: '32,269' },
]

/**
 * The unclaimed-spot placeholder. Kept out of `BRANDS` so it never shows up as
 * a brand you can browse — it is only used when a zone has no sponsor.
 */
export const SLOT = {
  id: 'slot', label: 'Your logo', mark: 'empty', fill: LIME, seed: 11,
  band: ['YOUR BRAND', 'YOUR BRAND'], handle: '@yourbrand', url: 'sponsormybody.com',
  amount: '$50', views: '0', blurb: 'This spot is open — claim it with your logo.',
}

export function findBrand(id) {
  if (id === SLOT.id) return SLOT
  return BRANDS.find((brand) => brand.id === id) ?? null
}

/**
 * Swaps the baked-in catalogue for the database rows (same shape). In place,
 * so every existing `BRANDS` / `findBrand` reference keeps working.
 */
export function replaceBrands(rows) {
  BRANDS.length = 0
  BRANDS.push(...rows)
  clearLogoCache()
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

/** Ink that stays legible on a fill — black on lime, black on orange, white on ink. */
function inkOn(fill) {
  return luminance(fill) > 0.45 ? INK : PAPER
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

  // Works on a context or a Path2D — the latter has no beginPath(), which is
  // what lets one exact path serve as both the fill and the matching clip.
  if (typeof ctx.beginPath === 'function') ctx.beginPath()
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

/**
 * The white die-cut dashes that ring an open spot. They sit close to the
 * silhouette and stay thin: in the reference this ring reads as a hairline, not
 * as a second border.
 */
function dieCut(ctx, x, y, w, h, radius, random) {
  const unit = Math.min(w, h)
  const gap = unit * 0.03
  ctx.save()
  ctx.setLineDash([unit * 0.075, unit * 0.055])
  ctx.lineWidth = unit * 0.024
  ctx.strokeStyle = DIE_CUT
  organicRoundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, radius + gap, random, 0.04)
  ctx.stroke()
  ctx.restore()
}

/**
 * Thin die-cut for claimed spots: same dashed language, but a true hairline
 * hugging the silhouette instead of a second border.
 */
function dieCutThin(ctx, x, y, w, h, radius, random) {
  const unit = Math.min(w, h)
  const gap = Math.max(2, unit * 0.008)
  ctx.save()
  ctx.setLineDash([unit * 0.04, unit * 0.03])
  ctx.lineWidth = Math.max(2, unit * 0.008)
  ctx.strokeStyle = DIE_CUT
  organicRoundRect(ctx, x - gap, y - gap, w + gap * 2, h + gap * 2, radius + gap, random, 0.04)
  ctx.stroke()
  ctx.restore()
}

/**
 * Hairline edge for uploaded logos: no white surround, just a thin solid
 * ring on the sticker silhouette so the logo reads on skin.
 */
function hairline(ctx, stickerPath, edge) {
  ctx.save()
  ctx.setLineDash([])
  ctx.lineWidth = Math.max(2, edge * 0.006)
  ctx.strokeStyle = DIE_CUT
  ctx.stroke(stickerPath)
  ctx.restore()
}

/**
 * The hand-drawn mark, traced into a 100×100 box: a hook at the top left, a
 * diagonal down to the lower left, a turn up into a large closed loop, and a
 * tail leaving to the right at mid-height.
 */
function drawGlyph(ctx, cx, cy, size, ink) {
  const u = size / 100
  const P = (x, y) => [cx + (x - 50) * u, cy + (y - 50) * u]

  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = 15 * u
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  ctx.beginPath()
  ctx.moveTo(...P(17, 31))
  // The hook: up over the top and down to the right.
  ctx.bezierCurveTo(...P(14, 12), ...P(40, 3), ...P(47, 21))
  // The diagonal stroke down to the lower left...
  ctx.bezierCurveTo(...P(53, 38), ...P(28, 55), ...P(15, 68))
  // ...turning there and climbing into the big loop.
  ctx.bezierCurveTo(...P(2, 82), ...P(24, 92), ...P(38, 76))
  ctx.bezierCurveTo(...P(54, 59), ...P(60, 26), ...P(74, 31))
  ctx.bezierCurveTo(...P(90, 37), ...P(85, 70), ...P(64, 81))
  ctx.bezierCurveTo(...P(46, 90), ...P(39, 73), ...P(52, 60))
  ctx.stroke()

  // Short tail leaving to the right at mid-height.
  ctx.beginPath()
  ctx.moveTo(...P(50, 60))
  ctx.lineTo(...P(93, 55))
  ctx.stroke()
  ctx.restore()
}

/**
 * A code mark printed straight onto the sticker fill — the fill is the quiet
 * zone, exactly as in the reference. Square finder patterns, dense modules.
 */
function drawCode(ctx, x, y, size, modules, ink, fill, seed) {
  const random = mulberry32(seed)
  const cell = size / modules

  const inFinder = (cx, cy) => {
    const corner = (ox, oy) => cx >= ox - 1 && cx < ox + 8 && cy >= oy - 1 && cy < oy + 8
    return corner(0, 0) || corner(modules - 7, 0) || corner(0, modules - 7)
  }

  ctx.save()
  ctx.fillStyle = ink
  for (let cy = 0; cy < modules; cy += 1) {
    for (let cx = 0; cx < modules; cx += 1) {
      if (inFinder(cx, cy)) continue
      if (random() > 0.5) {
        // A hair of bleed so adjacent modules never leave a seam at minification.
        ctx.fillRect(x + cx * cell, y + cy * cell, cell * 1.02, cell * 1.02)
      }
    }
  }

  // Finder eyes: 7×7 block, 5×5 knocked back out to the fill, 3×3 core.
  for (const [fx, fy] of [[0, 0], [modules - 7, 0], [0, modules - 7]]) {
    const px = x + fx * cell
    const py = y + fy * cell
    const s7 = cell * 7

    ctx.fillStyle = ink
    ctx.fillRect(px, py, s7, s7)
    ctx.fillStyle = fill
    ctx.fillRect(px + cell, py + cell, s7 - cell * 2, s7 - cell * 2)
    ctx.fillStyle = ink
    ctx.fillRect(px + cell * 2, py + cell * 2, s7 - cell * 4, s7 - cell * 4)
  }
  ctx.restore()
}

/** Condensed all-caps, faked by squeezing the glyphs horizontally. */
function condensed(ctx, text, cx, cy, size, ink, squeeze = 0.88) {
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
function fitSize(ctx, text, maxWidth, size, squeeze = 0.88) {
  let current = size
  ctx.font = `700 ${current}px Inter, sans-serif`
  while (current > 6 && ctx.measureText(text).width * squeeze > maxWidth) {
    current -= 2
    ctx.font = `700 ${current}px Inter, sans-serif`
  }
  return current
}

/**
 * Small slot number tucked in the bottom-right corner of a sticker.
 * Same ink as the artwork, no pill or background — ~5mm on the body whatever
 * the slot shape. Sits slightly inward so it stays on the flatter part of the
 * conformed quad instead of the curled corner. Empty spots sit on bare skin
 * (transparent), so their number gets a dark outline to read on both pale
 * skin and dark shorts, plus a higher alpha to survive alphaTest minified.
 */
function drawSlotNumber(ctx, w, h, inset, box, index, ink, alpha = 0.65, outline = null) {
  if (index === null || index === undefined) return
  const short = Math.min(box.w, box.h)
  const fontSize = Math.max(13, Math.min(32, short * 0.14))
  const x = w - inset - short * 0.15
  const y = h - inset - short * 0.12
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textAlign = 'right'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${fontSize}px Inter, sans-serif`
  if (outline) {
    ctx.lineWidth = Math.max(2, fontSize * 0.16)
    ctx.strokeStyle = outline
    ctx.strokeText(String(index), x, y)
  }
  ctx.fillStyle = ink
  ctx.fillText(String(index), x, y)
  ctx.restore()
}

/* ------------------------------------------------------------- stickers --- */

/**
 * The limb strap: two columns of type running the length of the slot. The brand
 * takes the lime column in ink; the model takes the second column, inverted to
 * black with white type. A hero-coloured strap keeps both columns in its own
 * colour, which is how the orange slot reads in the reference.
 */
function drawStrap(ctx, brand, box, fill, ink) {
  const { x, y, w, h } = box
  const lines = brand.band ?? [brand.label, brand.label]
  const model = lines[0] ?? brand.label
  const name = lines[1] ?? brand.label

  const hero = luminance(fill) < 0.7
  const split = w * (hero ? 0.5 : 0.53)

  const columns = [
    { x: x, w: w - split, fill, ink, text: model },
    { x: x + w - split, w: split, fill: hero ? fill : INK, ink: hero ? ink : PAPER, text: name },
  ]

  // Type runs up the strap, so the second column always carries the brand.
  columns.reverse()

  for (const column of columns) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(column.x, y, column.w, h)
    ctx.clip()
    ctx.fillStyle = column.fill
    ctx.fillRect(column.x, y, column.w, h)

    const size = fitSize(ctx, column.text, h * 0.86, column.w * 0.62)
    ctx.translate(column.x + column.w / 2, y + h / 2)
    ctx.rotate(-Math.PI / 2)
    condensed(ctx, column.text, 0, 0, size, column.ink)
    ctx.restore()
  }
}

/**
 * Draws an uploaded logo contain-fit inside a box, so any aspect lands
 * uncropped with even margins.
 */
function drawBrandImage(ctx, image, box, padScale = 0.12) {
  if (!image.naturalWidth || !image.naturalHeight) return
  const pad = Math.min(box.w, box.h) * padScale
  const dw = box.w - pad * 2
  const dh = box.h - pad * 2
  const scale = Math.min(dw / image.naturalWidth, dh / image.naturalHeight)
  const w = image.naturalWidth * scale
  const h = image.naturalHeight * scale
  ctx.drawImage(image, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h)
}

/**
 * Renders one sticker and returns the canvas.
 * `shape` is 'square' (chest, back, shoulder), 'band' (limbs) or 'wide' (waist).
 * `index` is the 1-based slot number, drawn small in the corner when set.
 */
export function createPatchCanvas(brand, { size = 512, shape = 'square', index = null } = {}) {
  const w = size
  const h = Math.round(size / patchAspect(shape))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')

  const random = mulberry32(brand.seed)
  const isEmpty = brand.mark === 'empty'
  const hasImage = brand.image?.naturalWidth > 0
  const fill = brand.fill ?? LIME
  const ink = inkOn(fill)
  // Empty spots sit background-free on the skin, so their graphics use white
  // to stay legible on the body.
  const placeholderInk = PAPER

  // Inset so the dashed ring still fits inside the canvas.
  const edge = Math.min(w, h)
  const inset = edge * 0.055
  const box = { x: inset, y: inset, w: w - inset * 2, h: h - inset * 2 }
  const radius = edge * (shape === 'band' ? 0.11 : shape === 'wide' ? 0.16 : 0.2)

  // Open spots keep the full dashed ring so they read on skin. Claimed spots
  // drop the thick white border: procedural stickers get a thin hairline,
  // uploaded logos get no surround at all — just a thin edge.
  if (isEmpty) {
    dieCut(ctx, box.x, box.y, box.w, box.h, radius, random)
  } else if (!hasImage) {
    dieCutThin(ctx, box.x, box.y, box.w, box.h, radius, random)
  }

  // One path, drawn once and reused as the clip — two separate calls would
  // consume different random values and the clip would cut into the artwork.
  const stickerPath = new Path2D()
  organicRoundRect(stickerPath, box.x, box.y, box.w, box.h, radius, random)

  // Empty spots stay background-free on the body: only the dashed ring, the
  // inner rule and the "+" remain, so the skin shows through.
  if (!isEmpty && !hasImage) {
    ctx.fillStyle = fill
    ctx.fill(stickerPath)
  }

  const cx = w / 2
  const cy = h / 2
  const short = Math.min(box.w, box.h)

  ctx.save()
  ctx.clip(stickerPath)

  if (hasImage) {
    // A buyer's uploaded logo sits straight on the skin — no white stock
    // base — contain-fit with only a thin transparent margin to the edge.
    drawBrandImage(ctx, brand.image, box, 0.04)
  } else if (isEmpty) {
    // A dashed inner rule plus a bold "+": the universal "claim me" slot.
    ctx.save()
    ctx.setLineDash([short * 0.07, short * 0.055])
    ctx.strokeStyle = placeholderInk
    ctx.globalAlpha = 0.7
    ctx.lineWidth = short * 0.03
    const pad = short * 0.16
    organicRoundRect(ctx, box.x + pad, box.y + pad, box.w - pad * 2, box.h - pad * 2, radius * 0.7, random, 0.05)
    ctx.stroke()
    ctx.restore()

    const arm = short * 0.3
    const thick = short * 0.095
    ctx.fillStyle = placeholderInk
    ctx.beginPath()
    ctx.roundRect(cx - arm / 2, cy - thick / 2, arm, thick, thick * 0.35)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(cx - thick / 2, cy - arm / 2, thick, arm, thick * 0.35)
    ctx.fill()

    drawSlotNumber(ctx, w, h, inset, box, index, placeholderInk, 0.95, INK)
  } else if (shape === 'band') {
    drawStrap(ctx, brand, box, fill, ink)
  } else if (shape === 'wide') {
    // A landscape slot carries the mark and the wordmark side by side.
    const markSize = box.h * 0.62
    const markX = box.x + box.w * 0.2

    if (brand.mark === 'code') {
      drawCode(ctx, markX - markSize / 2, cy - markSize / 2, markSize, 25, ink, fill, brand.seed)
    } else {
      drawGlyph(ctx, markX, cy, markSize, ink)
    }

    const label = brand.label.toUpperCase()
    const available = box.w * 0.48
    const fontSize = fitSize(ctx, label, available, box.h * 0.46)

    ctx.save()
    ctx.translate(box.x + box.w * 0.44 + available / 2, cy)
    ctx.fillStyle = ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = `700 ${fontSize}px Inter, sans-serif`
    ctx.fillText(label, 0, 0)
    ctx.restore()
  } else if (brand.mark === 'code') {
    const codeSize = short * 0.8
    drawCode(ctx, cx - codeSize / 2, cy - codeSize / 2, codeSize, 25, ink, fill, brand.seed)
  } else {
    drawGlyph(ctx, cx, cy, short * 0.56, ink)
  }

  if (hasImage) {
    // Outlined so the number reads on any logo and on skin.
    drawSlotNumber(ctx, w, h, inset, box, index, placeholderInk, 0.95, INK)
  } else if (!isEmpty) {
    drawSlotNumber(ctx, w, h, inset, box, index, ink)
  }

  ctx.restore()

  // Uploaded logos keep only this thin edge — no white surround.
  if (hasImage) hairline(ctx, stickerPath, edge)

  return canvas
}

/** Canvas → GPU texture. Cached per brand + shape + slot number so slider drags are free. */
const textureCache = new Map()

export function patchTexture(brand, shape = 'square', index = null) {
  const hasImage = brand.image?.naturalWidth > 0
  const key = `${brand.id}:${shape}:${index ?? ''}:${hasImage ? 'img' : 'art'}:${brand.logoUrl ?? ''}:${brand.seed ?? ''}`
  const cached = textureCache.get(key)
  if (cached) return cached

  const texture = new THREE.CanvasTexture(createPatchCanvas(brand, { shape, index }))
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  textureCache.set(key, texture)
  return texture
}

/** Data URL for <img>/background usage in the panel. */
export function patchDataUrl(brand, size = 256, shape = 'square', index = null) {
  return createPatchCanvas(brand, { size, shape, index }).toDataURL('image/png')
}

/**
 * The square brand tile on the sponsor card: the same sticker language, so the
 * card and the body read as one system.
 *
 * Data-URL encodes are cached — the sponsors list stamps one per row on every
 * open, and re-encoding PNGs on the main thread is what made that janky.
 */
const logoCache = new Map()

export function clearLogoCache() {
  logoCache.clear()
  textureCache.clear()
}

export function logoDataUrl(brand, size = 256) {
  const key = `${brand.id}:${size}:${brand.image?.naturalWidth > 0 ? 'img' : 'art'}`
  const cached = logoCache.get(key)
  if (cached) return cached
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')

  const random = mulberry32(brand.seed)
  const hasImage = brand.image?.naturalWidth > 0
  const isEmpty = !hasImage && brand.mark === 'empty'
  const fill = hasImage ? '#edf2f5' : (brand.fill ?? LIME)
  const ink = inkOn(fill)
  // Empty spots stay transparent (no yellow fill) so the row shows just the
  // dashed rule and the "+" — light artwork to read on the dark modal.
  const emptyInk = PAPER

  if (!isEmpty) {
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(0, 0, size, size, size * 0.24)
    ctx.fill()
  }

  if (hasImage) {
    drawBrandImage(ctx, brand.image, { x: 0, y: 0, w: size, h: size }, 0.16)
  } else if (isEmpty) {
    ctx.save()
    ctx.setLineDash([size * 0.04, size * 0.035])
    ctx.strokeStyle = emptyInk
    ctx.globalAlpha = 0.5
    ctx.lineWidth = size * 0.022
    ctx.beginPath()
    ctx.roundRect(size * 0.16, size * 0.16, size * 0.68, size * 0.68, size * 0.14)
    ctx.stroke()
    ctx.restore()

    const arm = size * 0.3
    const thick = size * 0.085
    ctx.fillStyle = emptyInk
    ctx.globalAlpha = 0.82
    ctx.beginPath()
    ctx.roundRect(size / 2 - arm / 2, size / 2 - thick / 2, arm, thick, thick * 0.35)
    ctx.fill()
    ctx.beginPath()
    ctx.roundRect(size / 2 - thick / 2, size / 2 - arm / 2, thick, arm, thick * 0.35)
    ctx.fill()
    ctx.globalAlpha = 1
  } else if (brand.mark === 'code') {
    drawCode(ctx, size * 0.13, size * 0.13, size * 0.74, 25, ink, fill, brand.seed)
  } else {
    drawGlyph(ctx, size / 2, size / 2, size * 0.6, ink)
  }

  // A little scuff so the tile is not a flat vector fill (skipped on
  // empty spots — the tile is transparent there).
  if (!isEmpty) {
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(0, 0, size, size, size * 0.24)
    ctx.clip()
    for (let i = 0; i < 90; i += 1) {
      ctx.fillStyle = random() > 0.5 ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.045)'
      ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3)
    }
    ctx.restore()
  }

  const url = canvas.toDataURL('image/png')
  logoCache.set(key, url)
  return url
}
