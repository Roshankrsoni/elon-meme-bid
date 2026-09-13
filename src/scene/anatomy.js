import * as THREE from 'three'

/**
 * Mesh-driven anatomical analysis.
 *
 * The scan ships as a single unnamed, unskinned mesh — no bones, no semantic
 * node names — so the body regions have to be inferred from the geometry
 * itself. Nothing here trusts a fixed X/Y/Z convention: the up axis, the facing
 * direction and every landmark are measured from the point cloud.
 *
 * Everything is computed in the avatar's own local space (the group that
 * `model.js` normalises), using an orthonormal basis:
 *
 *   up    — the body's long axis, from hem to crown
 *   front — the direction the chest and face point
 *   left  — `up × front`, so it is the figure's own left
 *
 * A point is then `left·lat + up·u + front·dep`, and heights are expressed as
 * `frac` from the hem (0) to the crown (1).
 */

const BANDS = 64

const _axis = (i) => new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0)

/** Linear lookup into a per-band array, band centres as the sample points. */
function sampleBand(values, frac) {
  if (!values.length) return 0
  const x = THREE.MathUtils.clamp(frac, 0, 1) * (values.length - 1)
  const i = Math.floor(x)
  const j = Math.min(values.length - 1, i + 1)
  return values[i] + (values[j] - values[i]) * (x - i)
}

function median(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * @param {Float32Array|Float64Array} points flat xyz triples in avatar-local space
 */
export function analyzeAnatomy(points) {
  const count = points.length / 3

  /* ---------------------------------------------------------------- axes -- */
  const min = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  for (let i = 0; i < count; i += 1) {
    min.x = Math.min(min.x, points[i * 3])
    min.y = Math.min(min.y, points[i * 3 + 1])
    min.z = Math.min(min.z, points[i * 3 + 2])
    max.x = Math.max(max.x, points[i * 3])
    max.y = Math.max(max.y, points[i * 3 + 1])
    max.z = Math.max(max.z, points[i * 3 + 2])
  }
  const size = new THREE.Vector3().subVectors(max, min)
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)

  // The long axis is up. `model.js` normalises on Y, so this is Y for this
  // asset — but deriving it means the analysis survives a re-authored model.
  const extents = [size.x, size.y, size.z]
  const upIndex = extents.indexOf(Math.max(...extents))
  const up = _axis(upIndex)

  // Of the two remaining axes, the shallower one is front/back depth (a torso
  // is wider than it is deep), the deeper one is left/right.
  const remaining = [0, 1, 2].filter((i) => i !== upIndex)
  const [a, b] = remaining
  const depthIndex = extents[a] <= extents[b] ? a : b
  const depthAxis = _axis(depthIndex)

  /* --------------------------------------------------------------- front -- */
  let uMin = Infinity
  let uMax = -Infinity
  for (let i = 0; i < count; i += 1) {
    const u = up.x * points[i * 3] + up.y * points[i * 3 + 1] + up.z * points[i * 3 + 2]
    uMin = Math.min(uMin, u)
    uMax = Math.max(uMax, u)
  }
  const height = uMax - uMin

  // The face protrudes further from the head's own centre than the back of the
  // skull does, so the head band settles the sign without guessing.
  let headDepMin = Infinity
  let headDepMax = -Infinity
  for (let i = 0; i < count; i += 1) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]
    const frac = (up.x * x + up.y * y + up.z * z - uMin) / height
    if (frac < 0.86 || frac > 0.97) continue
    const dep = depthAxis.x * x + depthAxis.y * y + depthAxis.z * z
    headDepMin = Math.min(headDepMin, dep)
    headDepMax = Math.max(headDepMax, dep)
  }
  const headCenter = (headDepMin + headDepMax) / 2
  const frontSign = headDepMax - headCenter >= headCenter - headDepMin ? 1 : -1
  const front = depthAxis.clone().multiplyScalar(frontSign)
  const left = new THREE.Vector3().crossVectors(up, front).normalize()

  /* ------------------------------------------------------------- profile -- */
  const bands = Array.from({ length: BANDS }, () => ({
    n: 0,
    latMin: Infinity,
    latMax: -Infinity,
    depMin: Infinity,
    depMax: -Infinity,
  }))

  const project = (i) => {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]
    return {
      u: up.x * x + up.y * y + up.z * z,
      lat: left.x * x + left.y * y + left.z * z,
      dep: front.x * x + front.y * y + front.z * z,
    }
  }

  for (let i = 0; i < count; i += 1) {
    const { u, lat, dep } = project(i)
    const band = bands[Math.min(BANDS - 1, Math.max(0, Math.floor(((u - uMin) / height) * BANDS)))]
    band.n += 1
    band.latMin = Math.min(band.latMin, lat)
    band.latMax = Math.max(band.latMax, lat)
    band.depMin = Math.min(band.depMin, dep)
    band.depMax = Math.max(band.depMax, dep)
  }

  const fracs = bands.map((_, i) => (i + 0.5) / BANDS)
  const halfWidth = bands.map((band) => (band.latMax - band.latMin) / 2)
  const outerLeft = bands.map((band) => band.latMin)
  const outerRight = bands.map((band) => band.latMax)
  const backDepth = bands.map((band) => -band.depMin)
  const frontDepth = bands.map((band) => band.depMax)

  /* ----------------------------------------------------------- landmarks -- */
  const headHalf = median(
    fracs.filter((f) => f > 0.85 && f < 0.98).map((f) => sampleBand(halfWidth, f)),
  )

  // Shoulders are the last height (below the head) that is broad. Above them
  // the silhouette collapses to the neck and skull.
  let shoulderFrac = 0.72
  for (let i = 0; i < BANDS; i += 1) {
    if (fracs[i] > 0.85) break
    if (halfWidth[i] > headHalf * 1.5) shoulderFrac = fracs[i]
  }

  // The pectorals are the highest forward bulge on the torso.
  let chestFrac = shoulderFrac - 0.14
  let chestDepth = -Infinity
  for (let i = 0; i < BANDS; i += 1) {
    const f = fracs[i]
    if (f < shoulderFrac - 0.34 || f > shoulderFrac - 0.04) continue
    if (frontDepth[i] > chestDepth) {
      chestDepth = frontDepth[i]
      chestFrac = f
    }
  }

  // The glutes are the deepest rearward bulge low on the bust.
  let hipFrac = 0.24
  let hipDepth = -Infinity
  for (let i = 0; i < BANDS; i += 1) {
    const f = fracs[i]
    if (f < 0.1 || f > 0.36) continue
    if (backDepth[i] > hipDepth) {
      hipDepth = backDepth[i]
      hipFrac = f
    }
  }

  // The waist sits between the chest and the hips — nearer the chest than the
  // hip, which is where a lumbar banner reads as a belt rather than a seat pad.
  const waistFrac = THREE.MathUtils.clamp(chestFrac - (chestFrac - hipFrac) * 0.42, 0.34, 0.62)

  /* ------------------------------------------------------------ sampling -- */
  const fracAt = (point) =>
    (up.x * point.x + up.y * point.y + up.z * point.z - uMin) / height

  /** A point from anatomical components, in avatar-local space. */
  const toPoint = (lat, frac, dep) =>
    new THREE.Vector3()
      .addScaledVector(left, lat)
      .addScaledVector(up, uMin + frac * height)
      .addScaledVector(front, dep)

  const series = { outerLeft, outerRight, frontDepth, backDepth, halfWidth }

  return {
    points,
    count,
    up,
    front,
    left,
    min,
    max,
    size,
    center,
    height,
    uMin,
    fracAt,
    toPoint,
    /** Sampled per-height profile, e.g. `sample('outerRight', 0.6)`. */
    sample: (name, frac) => sampleBand(series[name] ?? halfWidth, frac),
    landmarks: {
      neckFrac: Math.min(0.9, shoulderFrac + 0.03),
      shoulderFrac,
      chestFrac,
      waistFrac,
      hipFrac,
    },
  }
}
