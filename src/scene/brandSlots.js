import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { SLOT, findBrand, patchAspect, patchTexture } from '../ui/patches.js'
import { placement as config } from '../config.js'
import { analyzeAnatomy } from './anatomy.js'

/*
 * The scan is ~2M triangles, so a plain Raycaster costs tens of milliseconds
 * per ray. A slot is conformed to the skin with ~350 rays, which makes the
 * BVH non-optional.
 */
THREE.Mesh.prototype.raycast = acceleratedRaycast
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

const UP = new THREE.Vector3(0, 1, 0)
/** How far off the tangent plane a conformed vertex may travel. */
const PROBE_DEPTH = 0.12
const SURFACE_OFFSET = config.surfaceOffset
/** Minimum dot between a slot normal and a probed face normal to accept it. */
const SURFACE_ALIGNMENT = 0.35
const EMISSIVE = { idle: 0.6, hover: 0.85, active: 1.3 }

/** How far outside the body a slot's probe ray starts, in metres. */
const CAST_DISTANCE = 0.6
/*
 * The tangential search is anisotropic on purpose. Sweeping *across* the slot
 * (front-to-back on a limb, side-to-side on the torso) lets the cast find the
 * widest part of a curved limb; sweeping *along* it would drag the slot up or
 * down the body and collide it with its neighbour, so that is kept tight.
 */
const CAST_SCAN_ACROSS = 0.15
const CAST_SCAN_ALONG = 0.012
/** Grid resolution of that search, each way. */
const CAST_STEPS = 6

/** Scratch objects — the conform loop runs ~350 times per slot. */
const scratch = {
  quaternion: new THREE.Quaternion(),
  point: new THREE.Vector3(),
  probe: new THREE.Vector3(),
  hit: new THREE.Vector3(),
  normal: new THREE.Vector3(),
  normalMatrix: new THREE.Matrix3(),
}

/**
 * Frame that stands a marker upright against an arbitrary surface normal.
 * Works in any space whose up axis is +Y.
 */
export function frameQuaternion(normal) {
  const forward = normal.clone().normalize()
  const right = new THREE.Vector3().crossVectors(UP, forward)

  // Degenerate at the crown of the head / soles: any stable tangent will do.
  if (right.lengthSq() < 1e-5) right.set(1, 0, 0)
  right.normalize()

  const up = new THREE.Vector3().crossVectors(forward, right).normalize()
  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(right, up, forward),
  )
}

function rotationAbout(quaternion, axis, degrees) {
  if (!degrees) return quaternion.clone()
  return quaternion
    .clone()
    .premultiply(
      new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), THREE.MathUtils.degToRad(degrees)),
    )
}

/* ------------------------------------------------------------------ slots -- */

/**
 * The brand placements, expressed entirely in the detected anatomical frame
 * from `analyzeAnatomy`: a lateral offset along `left`, a height as a fraction
 * of the bust, and an outward facing direction. Nothing here is a hard-coded
 * world coordinate — the anchor is a *request* that `build()` resolves by
 * raycasting the real surface, and the marker is then bent onto that surface.
 */
export function brandSlotDefs(a) {
  const { up, front, left } = a
  const L = a.landmarks

  /*
   * Heights come straight off the measured landmarks. The chest slots sit on
   * the *upper* pectoral — above the nipple line, clear of the clavicle — the
   * deltoid head just under the shoulder line, and the waist banner immediately
   * above the waistband.
   */
  const shoulderFrac = L.shoulderFrac
  /**
   * The chest squares are centred on the pectoral: their top edge tucks under
   * the armpit and their bottom edge clears the nipple line.
   */
  const chestFrac = shoulderFrac - 0.093
  /*
   * The deltoid cap slopes in hard above the shoulder line, so the square is
   * anchored low enough that its top edge still lands on skin.
   */
  const deltoidFrac = shoulderFrac - 0.062
  const upperArmFrac = shoulderFrac - 0.145
  /*
   * The forearm band sits on the muscle belly below the elbow — the old height
   * just above the waist landed it on the elbow crease, where it bends and
   * distorts.
   */
  const forearmFrac = L.waistFrac - 0.04
  const backFrac = shoulderFrac - 0.115
  /**
   * The lower-back banner is printed on the shorts, so it sits just above the
   * seat — high enough to stay on the flatter panel and keep its bottom edge
   * straight — rather than down on the curved seat fold.
   */
  const waistFrac = L.hipFrac + (L.waistFrac - L.hipFrac) * 0.48

  /** Outermost silhouette edge on one side at a height. */
  const edge = (side, frac) => a.sample(side > 0 ? 'outerRight' : 'outerLeft', frac)

  /** Anchor on the outer surface of a limb, as a fraction of that edge. */
  const outer = (side, frac, k) => new THREE.Vector3()
    .addScaledVector(left, edge(side, frac) * k)
    .addScaledVector(up, a.uMin + frac * a.height)
    .addScaledVector(front, 0)

  const torsoLat = (frac, k) => a.sample('halfWidth', frac) * k
  /**
   * The spine, as a lateral offset. It is measured from the neck band — above
   * the shoulders, where the hanging arms cannot bias the silhouette — so that
   * the centred slots really do straddle it.
   */
  const spine = (edge(-1, shoulderFrac + 0.07) + edge(1, shoulderFrac + 0.07)) / 2
  /**
   * Limb slots must land out on the arm, not fold back onto the ribcage. The
   * bar is set against *this side's* silhouette — the pose is asymmetric enough
   * that the right arm hangs much closer in than the left.
   */
  const limbGuard = (side, frac, k = 0.6) => Math.abs(edge(side, frac)) * k

  const facingFront = () => front.clone()
  const facingBack = () => front.clone().negate()
  /**
   * Deltoid cap: outward and forward. A purely lateral cast slides to the very
   * edge of the shoulder and half the square wraps off the silhouette; a purely
   * upward one reaches over the top and lands on the clavicle.
   */
  const facingShoulder = (side) => new THREE.Vector3()
    .addScaledVector(left, side * 0.44)
    .addScaledVector(up, 0.26)
    .addScaledVector(front, 0.86)
    .normalize()
  /** Limb: squarely outward with a little forward bias off the silhouette. */
  const facingLimb = (side, tilt) => new THREE.Vector3()
    .addScaledVector(left, side)
    .addScaledVector(front, tilt)
    .normalize()

  const chestLat = torsoLat(chestFrac, 0.36)
  // Small screen-left nudge for the whole chest pair.
  const chestShift = torsoLat(chestFrac, 0.3)
  /**
   * The upper-back pair is mirrored about the spine: same height, same distance
   * either side, so the two squares read as one set on the shoulder blades.
   */
  const backLat = torsoLat(backFrac, 0.42)
  /**
   * The whole back set — both scapula squares and the waist banner — is nudged
   * toward the figure's own left, so the three read as one column down that
   * side of the back rather than as a set centred on the spine.
   */
  const backShift = torsoLat(backFrac, 0.13)
  /**
   * Slot 10 — the right scapula square — is tucked a little further in toward
   * its neighbour (slot 9, on the left scapula), so it closes the gap between
   * the pair instead of sitting at its mirrored distance from the spine.
   * Slot 9 gets only a small nudge back toward 10 to keep the pair balanced.
   */
  const backTuck = (side) => (side < 0 ? torsoLat(backFrac, 0.2) : torsoLat(backFrac, -0.08))
  /** How hard a slot is pulled to the outermost surface rather than the best-facing one. */
  const LIMB_BIAS = 6.5

  /** Symmetric pair helper — `side` is +1 for the figure's own left. */
  const pair = (name, make) => [
    { id: `${name}_Left`, side: 1, ...make(1) },
    { id: `${name}_Right`, side: -1, ...make(-1) },
  ]

  return [
    /*
     * CHEST — one large rounded square per pectoral, centred on the flat of
     * each pec and projected square onto the chest curvature.
     */
    ...pair('Chest', (side) => ({
      label: side > 0 ? 'Left chest' : 'Right chest',
      region: 'chest',
      frac: chestFrac,
      shape: 'square',
      sizeCm: 13,
      minBid: 100,
      /*
       * The chest is lopsided: the figure's own right pectoral turns away
       * faster, so a little less of the square can land on skin there.
       */
      minFit: 0.85,
      // Tight sweep: stays on the flat of the pec instead of sliding out to
      // the shoulder, which is what tilted slot 2 off the edge.
      scan: 0.022,
      // No vertical sweep: slots 1 and 2 stay at exactly chestFrac, level.
      scanAlong: 0,
      brandId: side > 0 ? 'higgs' : 'x',
      anchor: () => a.toPoint(spine - chestShift + chestLat * side, chestFrac, 0),
      facing: facingFront,
    })),

    /*
     * SHOULDERS — both shoulder squares removed, so the deltoid caps stay
     * bare skin.
     */

    /*
     * UPPER ARMS — a tall band on the outer biceps/triceps, cast laterally so
     * it lands on the outside of the arm instead of its silhouette edge.
     */
    ...pair('UpperArm', (side) => ({
      label: side > 0 ? 'Left upper arm' : 'Right upper arm',
      region: 'upper-arm',
      frac: upperArmFrac,
      shape: 'band',
      sizeCm: 4.8,
      minBid: 50,
      tight: true,
      minLat: limbGuard(side, upperArmFrac),
      outerBias: LIMB_BIAS,
      brandId: side > 0 ? 'kinet' : 'hypr',
      anchor: () => outer(side, upperArmFrac, 0.88),
      facing: () => facingLimb(side, 0.3),
    })),

    /*
     * FOREARMS — right forearm only (slot 5, left forearm, removed). The band
     * sits on the muscle belly below the elbow and rolls to follow the limb.
     */
    {
      id: 'Forearm_Right',
      side: -1,
      label: 'Right forearm',
      region: 'forearm',
      frac: forearmFrac,
      shape: 'band',
      sizeCm: 4,
      minBid: 50,
      tight: true,
      minLat: limbGuard(-1, forearmFrac),
      outerBias: LIMB_BIAS,
      // Roll the band so its long axis follows the limb instead of world-up.
      alignToLimb: true,
      brandId: 'flux',
      anchor: () => outer(-1, forearmFrac, 0.88),
      facing: () => facingLimb(-1, 0.25),
    },

    /*
     * UPPER BACK — one square per scapula, level with the shoulder blades and
     * inboard of the shoulder caps, so it never rides onto the deltoid.
     */
    ...pair('Back', (side) => ({
      label: side > 0 ? 'Left back' : 'Right back',
      region: 'upper-back',
      frac: backFrac,
      shape: 'square',
      sizeCm: 14,
      minBid: 100,
      minFit: 0.88,
      scan: 0.018,
      // No vertical sweep: both scapula squares stay at exactly backFrac, so
      // slots 9 and 10 sit level with each other.
      scanAlong: 0,
      // Right back intentionally unclaimed — 'slot' resolves to the placeholder.
      brandId: side > 0 ? 'orbit' : 'slot',
      anchor: () => a.toPoint(spine + backShift + backLat * side + backTuck(side), backFrac, 0),
      facing: facingBack,
    })),

    /*
     * LOWER BACK — a single wide banner on the flatter panel above the seat,
     * kept narrower so its ends don't wrap the hips and its bottom edge stays
     * straight.
     */
    {
      id: 'Back_Waist',
      label: 'Lower back',
      region: 'waist',
      frac: waistFrac,
      shape: 'wide',
      sizeCm: 16.5,
      minBid: 120,
      minFit: 0.85,
      scan: 0.03,
      brandId: 'pulse',
      anchor: () => a.toPoint(spine + backShift + torsoLat(waistFrac, 0.18), waistFrac, 0),
      facing: facingBack,
    },
  ]
}

/* ------------------------------------------------------------------ points -- */

/** Every mesh vertex, expressed in the avatar group's local space. */
function collectPoints(meshes, group) {
  let total = 0
  for (const mesh of meshes) total += mesh.geometry.attributes.position.count

  const points = new Float32Array(total * 3)
  const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert()
  const matrix = new THREE.Matrix4()
  const vertex = new THREE.Vector3()
  let offset = 0

  for (const mesh of meshes) {
    const attribute = mesh.geometry.attributes.position
    matrix.multiplyMatrices(toLocal, mesh.matrixWorld)
    for (let i = 0; i < attribute.count; i += 1) {
      vertex.fromBufferAttribute(attribute, i).applyMatrix4(matrix)
      points[offset] = vertex.x
      points[offset + 1] = vertex.y
      points[offset + 2] = vertex.z
      offset += 3
    }
  }
  return points
}

/**
 * The branded positions on the athlete.
 *
 * The anatomical regions are measured from the scan itself (see `anatomy.js`)
 * and every slot is projected onto the real surface and bent to it, so the
 * set survives a model swap, a rescale or a re-pose.
 *
 * The nodes live under a `BrandSlots` group parented to the avatar, so they
 * rotate with the body and each one is independently addressable, re-styleable
 * and replaceable.
 */
export class BrandSlots {
  constructor({ scene, camera, canvas }) {
    this.scene = scene
    this.camera = camera
    this.canvas = canvas

    this.avatar = null
    this.group = null
    /** @type {ReturnType<typeof analyzeAnatomy>|null} */
    this.anatomy = null

    this.raycaster = new THREE.Raycaster()
    this.raycaster.firstHitOnly = true

    this.probe = new THREE.Raycaster()
    this.probe.firstHitOnly = true

    // Reparented into the avatar once it exists.
    this.layer = new THREE.Group()
    this.layer.name = 'BrandSlots'

    /*
     * A slightly larger copy of the open marker, drawn behind it. Scaling a
     * conformed quad about its own centre lifts it clear of the skin just
     * enough to read as a ring around the patch.
     */
    this.outline = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x3fe9ff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    )
    this.outline.name = 'BrandSlots/outline'
    this.outline.renderOrder = 1
    this.outline.visible = false
    this.outline.matrixAutoUpdate = false
    this.layer.add(this.outline)

    /** @type {Map<string, object>} */
    this.items = new Map()
    this.armed = null
    this.hoveredId = null
    this.focusedId = null

    this.settings = {
      sizeCm: config.defaultSizeCm,
      rotationDeg: 0,
      opacity: 100,
    }

    this.listeners = new Set()
    this._pointer = null

    this._bind()
  }

  setAvatar(avatar) {
    this.avatar = avatar
    this.group = avatar.group
    this.group.updateMatrixWorld(true)
    this.group.add(this.layer)

    // Measure the body once, then place every slot against those landmarks.
    this.anatomy = analyzeAnatomy(collectPoints(avatar.meshes, this.group))
    this.build()
  }

  /* ------------------------------------------------------------ events -- */

  onChange(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onFocus(listener) {
    this.focusListeners ??= new Set()
    this.focusListeners.add(listener)
    return () => this.focusListeners.delete(listener)
  }

  _emit() {
    const payload = {
      items: [...this.items.values()],
      armed: this.armed,
      hoveredId: this.hoveredId,
      focusedId: this.focusedId,
      settings: { ...this.settings },
    }
    for (const listener of this.listeners) listener(payload)
  }

  _emitFocus() {
    const item = this.focusedId ? this.items.get(this.focusedId) : null
    for (const listener of this.focusListeners ?? []) listener(item)
  }

  notice(message) {
    this.onNotice?.(message)
  }

  _bind() {
    const el = this.canvas

    this._onDown = (event) => {
      this._pointer = { x: event.clientX, y: event.clientY, moved: false }
    }

    this._onMove = (event) => {
      if (this._pointer) {
        const dx = event.clientX - this._pointer.x
        const dy = event.clientY - this._pointer.y
        if (dx * dx + dy * dy > 36) this._pointer.moved = true
      }

      // Cheap enough to run every move: the marker set is small.
      const hit = this._pickMarker(event)
      const id = hit?.object.userData.slotId ?? null
      if (id !== this.hoveredId) {
        this.hoveredId = id
        this._applyHighlight()
        this._emit()
      }
    }

    this._onUp = (event) => {
      const pointer = this._pointer
      this._pointer = null
      if (!pointer || pointer.moved) return
      this._onClick(event)
    }

    el.addEventListener('pointerdown', this._onDown)
    window.addEventListener('pointermove', this._onMove)
    window.addEventListener('pointerup', this._onUp)
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown)
    window.removeEventListener('pointermove', this._onMove)
    window.removeEventListener('pointerup', this._onUp)
    for (const item of this.items.values()) {
      item.mesh.geometry.dispose()
      item.mesh.material.dispose()
    }
    this.items.clear()
  }

  /* ---------------------------------------------------------- pointing -- */

  _toNdc(event) {
    const rect = this.canvas.getBoundingClientRect()
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )
  }

  /** Nearest marker under the pointer, or null. */
  _pickMarker(event) {
    if (!this.avatar || this.items.size === 0) return null
    this.raycaster.far = Infinity
    this.raycaster.setFromCamera(this._toNdc(event), this.camera)
    const meshes = [...this.items.values()].map((item) => item.mesh)
    return this.raycaster.intersectObjects(meshes, false)[0] ?? null
  }

  _onClick(event) {
    if (!this.avatar) return

    const hit = this._pickMarker(event)
    const id = hit?.object.userData.slotId ?? null

    if (!id) {
      // Clicking off the body leaves focus mode rather than doing nothing.
      if (this.armed) this.notice('Pick one of the marked spots on the body.')
      else this.focus(null)
      return
    }

    if (this.armed) {
      const brand = this.armed
      this.assign(id, brand)
      this.setArmed(null)
      this.notice(`${this.items.get(id).def.label} is now sponsored by ${brand.label}.`)
      return
    }

    this.focus(id)
    // Opening a spot also offers its brand, so the bid can be raised or the
    // spot given up without leaving the body.
    const item = this.items.get(id)
    if (!item) return
    // Count taps on placed brands only — open placeholders don't count.
    if (item.brand.mark !== 'empty') this.onSpotClick?.(item)
    this.onOpenBid?.(item.brand, item)
  }

  /* ------------------------------------------------------------ surface -- */

  _surfaceNormal(hit) {
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)
    return hit.face.normal.clone().applyMatrix3(normalMatrix).normalize()
  }

  /**
   * Bends the marker quad onto the skin: every grid vertex is projected along
   * the surface normal and pulled onto the first co-facing surface it meets, so
   * a flat decal cannot sink into a curved chest.
   */
  _conformGeometry(width, localOrigin, localQuaternion, localNormal, shape = 'square', alignment = SURFACE_ALIGNMENT) {
    const geometry = new THREE.PlaneGeometry(width, width / patchAspect(shape), 20, 15)
    const position = geometry.attributes.position

    this.group.getWorldQuaternion(scratch.quaternion)
    const worldNormal = localNormal.clone().applyQuaternion(scratch.quaternion).normalize()
    const direction = worldNormal.clone().negate()

    const frame = new THREE.Matrix4().compose(localOrigin, localQuaternion, new THREE.Vector3(1, 1, 1))
    const inverseFrame = frame.clone().invert()

    /*
     * A vertex may only move this far off the tangent plane, or a nearby limb
     * can drag half the quad with it. Scaled off the quad's LONG side: on a
     * narrow band the far ends sit much further from the tangent point than the
     * width suggests.
     */
    const long = Math.max(width, width / patchAspect(shape))
    /*
     * How far off the tangent plane a vertex may be pulled. Loose enough that a
     * square laid over the round of a shoulder stays on the skin, tight enough
     * that it cannot climb the neighbouring limb instead.
     */
    const maxDeviation = long * 0.3
    const nearLimit = Math.max(0.004, PROBE_DEPTH - maxDeviation)
    const farLimit = PROBE_DEPTH + maxDeviation
    let conformed = 0

    for (let i = 0; i < position.count; i += 1) {
      const px = position.getX(i)
      const py = position.getY(i)

      scratch.point.set(px, py, 0).applyMatrix4(frame)
      scratch.probe.copy(scratch.point).addScaledVector(localNormal, PROBE_DEPTH)
      this.group.localToWorld(scratch.probe)

      this.probe.near = 0
      this.probe.far = farLimit
      this.probe.set(scratch.probe, direction)

      const hit = this.probe.intersectObjects(this.avatar.meshes, false)[0]

      if (hit && hit.distance >= nearLimit && hit.distance <= farLimit) {
        scratch.normal
          .copy(hit.face.normal)
          .applyMatrix3(scratch.normalMatrix.getNormalMatrix(hit.object.matrixWorld))
          .normalize()

        const deviation = Math.abs(hit.distance - PROBE_DEPTH)
        const aligned = scratch.normal.dot(worldNormal) >= alignment

        /*
         * Only co-facing surface counts toward coverage, but any surface the
         * probe meets close to the tangent plane is glued to — that is what
         * stops a square laid over the round of a shoulder from tearing off
         * into the air along the silhouette.
         */
        if (aligned || deviation <= maxDeviation * 0.5) {
          scratch.hit.copy(hit.point)
          this.group.worldToLocal(scratch.hit)
          scratch.hit.addScaledVector(localNormal, SURFACE_OFFSET)
          scratch.hit.applyMatrix4(inverseFrame)
          position.setXYZ(i, scratch.hit.x, scratch.hit.y, scratch.hit.z)
          if (aligned) conformed += 1
          continue
        }
      }

      position.setXYZ(i, px, py, SURFACE_OFFSET)
    }

    position.needsUpdate = true
    geometry.computeVertexNormals()
    geometry.computeBoundingSphere()
    geometry.computeBoundingBox()
    return { geometry, coverage: conformed / position.count }
  }

  _materialFor(brand, opacity, shape = 'square', index = null) {
    const map = patchTexture(brand, shape, index)
    return new THREE.MeshStandardMaterial({
      map,
      /*
       * A printed patch is a diffuse surface, so the diffuse term has to stay
       * dominant — otherwise the marker stops responding to light and reads as
       * a pasted-on decal. The emissive lift only replaces what the dim arena
       * would otherwise take out of the brand colour.
       */
      color: 0xa8a8a8,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: map,
      emissiveIntensity: EMISSIVE.idle,
      envMapIntensity: 0.15,
      transparent: true,
      opacity: opacity / 100,
      alphaTest: 0.35,
      depthWrite: true,
      roughness: 0.55,
      metalness: 0,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    })
  }

  /* -------------------------------------------------------------- build -- */

  /**
   * Resolves every anatomical slot onto the body.
   *
   * For each slot a short tangential sweep is cast inward along the slot's own
   * facing direction and the most squarely-facing surface is taken, so a slot
   * lands on the flat of a pec or the outside of a biceps rather than on a
   * crease. The quad is then conformed to that surface.
   */
  build() {
    if (!this.avatar || !this.anatomy) return

    const a = this.anatomy
    const raycaster = new THREE.Raycaster()
    raycaster.firstHitOnly = true

    const worldQuaternion = this.group.getWorldQuaternion(new THREE.Quaternion())
    const defs = brandSlotDefs(a)

    for (const [slotIndex, def] of defs.entries()) {
      // 1-based index, kept on the item and the mesh so a spot can be addressed.
      const slotNumber = slotIndex + 1
      const localFacing = def.facing(a).clone().normalize()
      const worldFacing = localFacing.clone().applyQuaternion(worldQuaternion).normalize()
      const worldAnchor = this.group.localToWorld(def.anchor(a).clone())

      // Two tangents to the facing direction: the sweep slides the cast across
      // the surface instead of trusting one point.
      const tangentA = new THREE.Vector3().crossVectors(UP, localFacing)
      if (tangentA.lengthSq() < 1e-6) tangentA.set(1, 0, 0)
      tangentA.normalize().applyQuaternion(worldQuaternion)
      const tangentB = new THREE.Vector3()
        .crossVectors(localFacing, new THREE.Vector3().crossVectors(UP, localFacing))
        .normalize()
      if (!Number.isFinite(tangentB.x)) tangentB.copy(UP)
      tangentB.applyQuaternion(worldQuaternion)

      const steps = CAST_STEPS
      const scanAcross = def.scan ?? CAST_SCAN_ACROSS
      const scanAlong = def.scanAlong ?? CAST_SCAN_ALONG
      const origin = new THREE.Vector3()
      const inward = worldFacing.clone().negate()
      let hit = null
      let bestScore = -Infinity
      // The best candidate that also clears the limb guard, if any.
      let guarded = null
      let guardedScore = -Infinity

      for (let i = -steps; i <= steps; i += 1) {
        for (let j = -steps; j <= steps; j += 1) {
          const u = (i / steps) * scanAcross
          const v = (j / steps) * scanAlong

          origin
            .copy(worldAnchor)
            .addScaledVector(tangentA, u)
            .addScaledVector(tangentB, v)
            .addScaledVector(worldFacing, CAST_DISTANCE)

          raycaster.set(origin, inward)
          const candidate = raycaster.intersectObjects(this.avatar.meshes, false)[0]
          if (!candidate) continue

          const normal = this._surfaceNormal(candidate)
          const facing = normal.dot(worldFacing)

          /*
           * Torso slots go to the most squarely-facing surface. Limb slots are
           * additionally pulled toward the *outermost* one: on a hanging arm the
           * best-facing patch can sit against the ribs, whereas the furthest
           * point is the belly of the muscle. `outerBias` sets how much.
           */
          let score = facing
          let onLimb = true
          if (def.minLat !== undefined || def.outerBias !== undefined) {
            const local = this.group.worldToLocal(candidate.point.clone())
            const lateral = Math.abs(local.dot(a.left))
            if (def.minLat !== undefined) onLimb = lateral >= def.minLat
            score = facing + lateral * (def.outerBias ?? 0)
          }

          if (score > bestScore) {
            bestScore = score
            hit = candidate
          }
          if (onLimb && score > guardedScore) {
            guardedScore = score
            guarded = candidate
          }
        }
      }

      if (guarded) hit = guarded
      else if (def.minLat !== undefined) {
        console.warn(`[BrandSlots] "${def.id}" found no surface out on the limb`)
      }

      if (!hit) {
        console.warn(`[BrandSlots] no surface found for "${def.id}"`)
        continue
      }

      const worldPoint = hit.point.clone()
      const worldNormal = this._surfaceNormal(hit)

      const localOrigin = this.group.worldToLocal(worldPoint.clone())
      const localNormal = worldNormal
        .clone()
        .applyQuaternion(worldQuaternion.clone().invert())
        .normalize()
      let localQuaternion = frameQuaternion(localNormal)

      /*
       * Limb bands roll so their long axis follows the limb: the limb's
       * direction is measured from the silhouette edge above and below the
       * slot, expressed in the sticker frame, and the frame is spun about its
       * own normal to match. Mirrors automatically via each side's edge.
       */
      if (def.alignToLimb && def.side !== undefined) {
        const span = 0.03
        const key = def.side > 0 ? 'outerRight' : 'outerLeft'
        const limbPoint = (frac) => new THREE.Vector3()
          .addScaledVector(a.left, a.sample(key, frac) * 0.88)
          .addScaledVector(a.up, a.uMin + frac * a.height)
        const downLimb = limbPoint(def.frac - span).sub(limbPoint(def.frac + span))
        if (downLimb.lengthSq() > 1e-10) {
          downLimb.normalize().addScaledVector(localNormal, -downLimb.dot(localNormal)).normalize()
          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(localQuaternion)
          const upAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(localQuaternion)
          const tiltDeg = THREE.MathUtils.radToDeg(
            Math.atan2(-downLimb.dot(right), downLimb.dot(upAxis)),
          )
          if (Number.isFinite(tiltDeg)) localQuaternion = rotationAbout(localQuaternion, localNormal, tiltDeg)
        }
      }

      const brand = findBrand(def.brandId) ?? SLOT

      /*
       * A thin limb — a bicep — cannot carry a full-size patch without half of
       * it hanging off the silhouette, so the marker steps down until enough of
       * it lands on co-facing surface. Limb spots are held to a stricter fit.
       */
      const shape = def.shape ?? 'square'
      let sizeCm = def.sizeCm
      let geometry = null
      let coverage = 0
      const need = def.minFit ?? (def.tight ? 0.9 : config.minCoverage)

      for (const scale of [1, 0.85, 0.7, 0.56, 0.44]) {
        const attempt = this._conformGeometry(
          (sizeCm * scale) / 100,
          localOrigin,
          localQuaternion,
          localNormal,
          shape,
          def.alignment ?? SURFACE_ALIGNMENT,
        )
        if (attempt.coverage >= need) {
          sizeCm *= scale
          geometry = attempt.geometry
          coverage = attempt.coverage
          break
        }
        attempt.geometry.dispose()
      }

      if (!geometry) {
        console.warn(`[BrandSlots] "${def.id}" has no flat enough surface`)
        continue
      }

      const mesh = new THREE.Mesh(geometry, this._materialFor(brand, 100, shape, slotNumber))
      mesh.name = `BrandSlots/${def.id}`
      mesh.renderOrder = 2
      mesh.userData.slotId = def.id
      mesh.userData.slotNumber = slotNumber
      mesh.userData.region = def.region
      mesh.position.copy(localOrigin)
      mesh.quaternion.copy(localQuaternion)
      mesh.updateMatrix()
      this.layer.add(mesh)

      this.items.set(def.id, {
        id: def.id,
        def,
        brand,
        mesh,
        slotNumber,
        localOrigin,
        localNormal,
        localQuaternion,
        worldPoint,
        worldNormal,
        shape,
        sizeCm,
        coverage,
        rotationDeg: def.rotation ?? 0,
        opacity: 100,
      })
    }

    this._emit()
  }

  /** Empties a spot, leaving the placeholder artwork behind. */
  clearZone(id) {
    const item = this.items.get(id)
    if (!item || item.brand === SLOT) return
    this.assign(id, SLOT)
    this.notice(`${item.def.label} is open again.`)
  }

  /** Swaps the brand artwork on a zone without rebuilding its geometry. */
  assign(id, brand) {
    const item = this.items.get(id)
    if (!item) return

    const map = patchTexture(brand, item.shape, item.slotNumber ?? null)
    item.brand = brand
    item.mesh.material.map = map
    item.mesh.material.emissiveMap = map
    item.mesh.material.needsUpdate = true
    this._emit()
  }

  _applyHighlight() {
    for (const [id, item] of this.items) {
      const active = id === this.focusedId
      const hovered = id === this.hoveredId
      item.mesh.material.emissiveIntensity = active
        ? EMISSIVE.active
        : hovered
          ? EMISSIVE.hover
          : EMISSIVE.idle
    }

    const open = this.focused
    this.outline.visible = !!open
    if (!open) return

    this.outline.geometry = open.mesh.geometry
    this.outline.position.copy(open.mesh.position)
    this.outline.quaternion.copy(open.mesh.quaternion)
    this.outline.scale.set(1.075, 1.075, 1)
    this.outline.updateMatrix()
  }

  /* ------------------------------------------------------------- public -- */

  setArmed(brand) {
    this.armed = brand ?? null
    this.canvas.style.cursor = this.armed ? 'crosshair' : ''
    if (this.armed) this.notice(`Now pick a spot — ${this.armed.label} goes where you click.`)
    this._emit()
  }

  /** Opens a spot: the camera flies to it and its bid dialog opens. */
  focus(id) {
    this.focusedId = id ?? null

    const item = this.focused
    if (item) {
      this.settings.sizeCm = item.sizeCm
      this.settings.rotationDeg = item.rotationDeg
      this.settings.opacity = item.opacity
    }

    this._applyHighlight()
    this._emit()
    this._emitFocus()
  }

  /** Places the focused marker flat against the camera-facing side of the body. */
  updateSettings({ sizeCm, rotationDeg, opacity }) {
    if (sizeCm === undefined && rotationDeg === undefined && opacity === undefined) return

    const item = this.focusedId ? this.items.get(this.focusedId) : null
    if (!item) return

    if (sizeCm !== undefined) {
      item.sizeCm = sizeCm
      this.settings.sizeCm = sizeCm
      item.mesh.geometry.dispose()
      item.mesh.geometry = this._conformGeometry(
        sizeCm / 100,
        item.localOrigin,
        item.localQuaternion,
        item.localNormal,
        item.shape,
        item.def.alignment ?? SURFACE_ALIGNMENT,
      ).geometry
    }
    if (rotationDeg !== undefined) {
      item.rotationDeg = rotationDeg
      this.settings.rotationDeg = rotationDeg
      item.mesh.quaternion.copy(rotationAbout(item.localQuaternion, item.localNormal, rotationDeg))
      item.mesh.updateMatrix()
    }
    if (opacity !== undefined) {
      item.opacity = opacity
      this.settings.opacity = opacity
      item.mesh.material.opacity = opacity / 100
    }

    this._emit()
  }

  get count() {
    return this.items.size
  }

  get focused() {
    return this.focusedId ? this.items.get(this.focusedId) : null
  }
}
