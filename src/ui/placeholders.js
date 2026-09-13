/**
 * The reference design shows a photo avatar and a second camera feed. Rather
 * than ship stock photography, both are drawn as abstract canvases — swap in
 * <img> tags whenever real assets exist.
 */

function noise(ctx, width, height, amount = 0.04, seed = 5) {
  let a = seed
  const random = () => {
    a = (a * 1664525 + 1013904223) % 4294967296
    return a / 4294967296
  }
  for (let i = 0; i < (width * height) / 42; i += 1) {
    ctx.fillStyle = random() > 0.5 ? `rgba(255,255,255,${amount})` : `rgba(0,0,0,${amount})`
    ctx.fillRect(random() * width, random() * height, 1, 1)
  }
}

function silhouette(ctx, cx, cy, scale, fill) {
  ctx.save()
  ctx.fillStyle = fill

  // Head.
  ctx.beginPath()
  ctx.ellipse(cx, cy - 46 * scale, 25 * scale, 31 * scale, 0, 0, Math.PI * 2)
  ctx.fill()

  // Neck.
  ctx.fillRect(cx - 9 * scale, cy - 20 * scale, 18 * scale, 16 * scale)

  // Shoulders and torso.
  ctx.beginPath()
  ctx.moveTo(cx - 62 * scale, cy + 74 * scale)
  ctx.quadraticCurveTo(cx - 60 * scale, cy - 6 * scale, cx - 20 * scale, cy - 4 * scale)
  ctx.lineTo(cx + 20 * scale, cy - 4 * scale)
  ctx.quadraticCurveTo(cx + 60 * scale, cy - 6 * scale, cx + 62 * scale, cy + 74 * scale)
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

/** Small circular profile picture. */
export function paintAvatar(canvas) {  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas

  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, '#1d3242')
  bg.addColorStop(1, '#0a121b')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  ctx.save()
  ctx.globalAlpha = 0.75
  silhouette(ctx, w / 2, h * 0.52, 0.62, 'rgba(150, 196, 214, 0.55)')
  ctx.restore()

  noise(ctx, w, h, 0.05, 11)

  const shade = ctx.createLinearGradient(0, 0, 0, h)
  shade.addColorStop(0, 'rgba(31,214,240,0.16)')
  shade.addColorStop(0.6, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.35)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, w, h)
}

/** Tall "second camera" tile: a mirrored gym corner with a back-view figure. */
export function paintFeed(canvas) {
  const ctx = canvas.getContext('2d')
  const { width: w, height: h } = canvas

  const bg = ctx.createLinearGradient(0, 0, w * 0.4, h)
  bg.addColorStop(0, '#182634')
  bg.addColorStop(0.55, '#0e1822')
  bg.addColorStop(1, '#070c13')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // Tiled wall.
  ctx.strokeStyle = 'rgba(255,255,255,0.045)'
  ctx.lineWidth = 1
  const tile = w / 6
  for (let x = 0; x <= w; x += tile) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h * 0.72)
    ctx.stroke()
  }
  for (let y = 0; y <= h * 0.72; y += tile) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }

  // Counter / ledge.
  ctx.fillStyle = 'rgba(255,255,255,0.07)'
  ctx.fillRect(0, h * 0.7, w, h * 0.035)
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fillRect(0, h * 0.735, w, h * 0.265)

  // Back-view figure.
  ctx.save()
  ctx.globalAlpha = 0.9
  silhouette(ctx, w * 0.5, h * 0.44, 0.82, 'rgba(18, 27, 36, 0.95)')
  ctx.restore()

  // Cyan pump of light from the left, like the reference's emissive room.
  const glow = ctx.createRadialGradient(w * 0.15, h * 0.3, 0, w * 0.15, h * 0.3, h * 0.6)
  glow.addColorStop(0, 'rgba(31,214,240,0.2)')
  glow.addColorStop(1, 'rgba(31,214,240,0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, w, h)

  // Sensor treat: scanlines, a timecode and a focus bracket.
  ctx.fillStyle = 'rgba(255,255,255,0.028)'
  for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1)

  ctx.strokeStyle = 'rgba(198,242,240,0.5)'
  ctx.lineWidth = 1.4
  const bx = w * 0.2
  const by = h * 0.22
  const bs = w * 0.22
  const corner = (cx, cy, dx, dy) => {
    ctx.beginPath()
    ctx.moveTo(cx + dx * bs, cy)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx, cy + dy * bs)
    ctx.stroke()
  }
  corner(bx, by, 1, 1)
  corner(bx + bs * 2, by, -1, 1)
  corner(bx, by + bs * 2, 1, -1)
  corner(bx + bs * 2, by + bs * 2, -1, -1)

  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.font = "500 11px 'JetBrains Mono', monospace"
  ctx.fillText('02  14:32:07', w * 0.08, h * 0.965)

  noise(ctx, w, h, 0.05, 23)

  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)
}

/**
 * Draws a profile photo into the avatar canvas (cover-fit, circular clip).
 * Paints the abstract art first so there is always something sensible if the
 * photo fails to load.
 */
export function avatarPhoto(canvas, url) {
  paintAvatar(canvas)
  if (!url) return

  const image = new Image()
  image.onload = () => {
    const ctx = canvas.getContext('2d')
    const { width: w, height: h } = canvas
    const scale = Math.max(w / image.width, h / image.height)
    const dw = image.width * scale
    const dh = image.height * scale
    ctx.save()
    ctx.beginPath()
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh)
    ctx.restore()
  }
  image.src = url
}
