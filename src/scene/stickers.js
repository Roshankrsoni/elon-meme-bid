import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { PATCH_ASPECT, SLOT, findBrand, patchTexture } from '../ui/patches.js'
import { model as modelConfig, placement as config, zones as zoneDefs } from '../config.js'

/*
 * The scan is ~2M triangles, so a plain Raycaster costs tens of milliseconds
 * per ray. A marker is conformed to the skin with ~350 rays, which makes the
 * BVH non-optional.
 */
THREE.Mesh.prototype.raycast = acceleratedRaycast
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree

const UP = new THREE.Vector3(0, 1, 0)
const PROBE_DEPTH = 0.1
const SURFACE_OFFSET = config.surfaceOffset
/** Minimum dot between a marker normal and a probed face normal to accept it. */
const SURFACE_ALIGNMENT = 0.35
const EMISSIVE = { idle: 0.14, hover: 0.3, active: 0.46 }

/** Scratch objects — the conform loop runs ~350 times per marker. */
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

/**
 * The sponsored positions on the body.
 *
 * Brands can only go in these eight spots — there is no free placement. A click
 * on a marker either claims it for the armed brand or pulls the camera in to
 * read that sponsor's card.
 *
 * Built before the scan arrives so the studio UI is live during the download;
 * `setAvatar()` hands it the mesh.
 */
export class BodyZones {
  constructor({ scene, camera, canvas }) {
    this.scene = scene
    this.camera = camera
    this.canvas = canvas

    this.avatar = null
    this.group = null

    this.raycaster = new THREE.Raycaster()
    this.raycaster.firstHitOnly = true

    this.probe = new THREE.Raycaster()
    this.probe.firstHitOnly = true

    // Reparented into the avatar once it exists.
    this.layer = new THREE.Group()
    this.layer.name = 'zones'

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
    this._lastHover = 0

    this._bind()
  }

  setAvatar(avatar) {
    this.avatar = avatar
    this.group = avatar.group
    this.group.add(this.layer)
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
      const id = hit?.object.userData.zoneId ?? null
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
    const id = hit?.object.userData.zoneId ?? null

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
  _conformGeometry(width, localOrigin, localQuaternion, localNormal) {
    const geometry = new THREE.PlaneGeometry(width, width / PATCH_ASPECT, 20, 15)
    const position = geometry.attributes.position

    this.group.getWorldQuaternion(scratch.quaternion)
    const worldNormal = localNormal.clone().applyQuaternion(scratch.quaternion).normalize()
    const direction = worldNormal.clone().negate()

    const frame = new THREE.Matrix4().compose(localOrigin, localQuaternion, new THREE.Vector3(1, 1, 1))
    const inverseFrame = frame.clone().invert()

    // A vertex may only move this far off the tangent plane, or a nearby limb
    // can drag half the quad with it.
    const maxDeviation = width * 0.25
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

        if (scratch.normal.dot(worldNormal) >= SURFACE_ALIGNMENT) {
          scratch.hit.copy(hit.point)
          this.group.worldToLocal(scratch.hit)
          scratch.hit.addScaledVector(localNormal, SURFACE_OFFSET)
          scratch.hit.applyMatrix4(inverseFrame)
          position.setXYZ(i, scratch.hit.x, scratch.hit.y, scratch.hit.z)
          conformed += 1
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

  _materialFor(brand, opacity) {
    const map = patchTexture(brand)
    return new THREE.MeshStandardMaterial({
      map,
      /*
       * A printed patch is a diffuse surface, and in this dim arena the diffuse
       * term is small — so the emissive lift has to stay well below it or the
       * marker stops responding to light and reads as a pasted-on decal.
       */
      color: 0xd0d0d0,
      emissive: new THREE.Color(0xffffff),
      emissiveMap: map,
      emissiveIntensity: EMISSIVE.idle,
      envMapIntensity: 0.25,
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

  /** Projects every zone onto the body and hangs its marker there. */
  build() {
    if (!this.avatar) return

    const raycaster = new THREE.Raycaster()
    raycaster.firstHitOnly = true
    const origin = new THREE.Vector3()
    const direction = new THREE.Vector3()

    for (const def of zoneDefs) {
      const fromBack = def.from === 'back'
      // `at` is [x, fraction up the bust]; the height is derived so the spots
      // stay on the right anatomy if the figure is rescaled or re-seated.
      const y = modelConfig.baseY + def.at[1] * modelConfig.height

      direction.set(0, 0, fromBack ? 1 : -1)
      origin.set(def.at[0], y, fromBack ? -0.9 : 0.9)

      raycaster.set(origin, direction)
      const hit = raycaster.intersectObjects(this.avatar.meshes, false)[0]
      if (!hit) {
        console.warn(`[zones] no surface found for "${def.id}"`)
        continue
      }

      const worldPoint = hit.point.clone()
      const worldNormal = this._surfaceNormal(hit)

      const localOrigin = this.group.worldToLocal(worldPoint.clone())
      const localNormal = worldNormal
        .clone()
        .applyQuaternion(this.group.getWorldQuaternion(new THREE.Quaternion()).invert())
        .normalize()
      const localQuaternion = frameQuaternion(localNormal)

      const brand = findBrand(def.brandId) ?? SLOT

      /*
       * A thin limb — a bicep — cannot carry a full-size patch without half of
       * it hanging off the silhouette, so the marker steps down until enough of
       * it lands on co-facing surface. Limb spots are held to a stricter fit.
       */
      let sizeCm = def.sizeCm
      let geometry = null
      const need = def.tight ? 0.94 : config.minCoverage

      for (const scale of [1, 0.85, 0.7, 0.56, 0.44]) {
        const attempt = this._conformGeometry(
          (sizeCm * scale) / 100,
          localOrigin,
          localQuaternion,
          localNormal,
        )
        if (attempt.coverage >= need) {
          sizeCm *= scale
          geometry = attempt.geometry
          break
        }
        attempt.geometry.dispose()
      }

      if (!geometry) {
        console.warn(`[zones] "${def.id}" has no flat enough surface`)
        continue
      }

      const mesh = new THREE.Mesh(geometry, this._materialFor(brand, 100))
      mesh.name = `zone-${def.id}`
      mesh.renderOrder = 2
      mesh.userData.zoneId = def.id
      mesh.position.copy(localOrigin)
      mesh.quaternion.copy(localQuaternion)
      mesh.updateMatrix()
      this.layer.add(mesh)

      this.items.set(def.id, {
        id: def.id,
        def,
        brand,
        mesh,
        localOrigin,
        localNormal,
        localQuaternion,
        worldPoint,
        worldNormal,
        sizeCm,
        rotationDeg: def.rotation ?? 0,
        opacity: 100,
      })
    }

    this._emit()
  }

  /** Swaps the brand artwork on a zone without rebuilding its geometry. */
  assign(id, brand) {
    const item = this.items.get(id)
    if (!item) return

    const map = patchTexture(brand)
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
  }

  /* ------------------------------------------------------------- public -- */

  setArmed(brand) {
    this.armed = brand ?? null
    this.canvas.style.cursor = this.armed ? 'crosshair' : ''
    if (this.armed) this.notice(`Now pick a spot — ${this.armed.label} goes where you click.`)
    this._emit()
  }

  /** Opens a spot: it becomes the slider target and the camera flies to it. */
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
