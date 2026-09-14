import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { inject } from '@vercel/analytics'

import { buildEnvironment } from './scene/environment.js'
import { loadAvatar } from './scene/model.js'
import { BrandSlots } from './scene/brandSlots.js'
import { initHud } from './ui/hud.js'
import { initSponsors } from './ui/panel.js'
import { replaceBrands } from './ui/patches.js'
import { fetchBrands, loadBrandImage } from './lib/bidding.js'
import { paintAllPaidBids, settlePaymentReturn, showToast } from './lib/bidding.js'
import { camera as cameraConfig, orbit } from './config.js'

// Initialize Vercel Analytics
inject()

const canvas = document.querySelector('#scene')
const loader = document.querySelector('#js-loader')
const progressBar = document.querySelector('#js-progress')
const progressPct = document.querySelector('#js-progress-pct')
const progressLabel = document.querySelector('#js-progress-label')

const setProgress = (fraction, label) => {
  const pct = Math.round(THREE.MathUtils.clamp(fraction, 0, 1) * 100)
  progressBar.style.width = `${pct}%`
  progressPct.textContent = `${pct}%`
  if (label) progressLabel.textContent = label
}

/* ------------------------------------------------------------- renderer -- */

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
})
/*
 * No setSize() here: it would write an inline pixel width onto the canvas and
 * win over the stylesheet, freezing the viewport at its first size. resize()
 * owns the drawing buffer and passes updateStyle = false.
 */
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x050810)

const camera = new THREE.PerspectiveCamera(
  cameraConfig.fov,
  window.innerWidth / window.innerHeight,
  0.05,
  120,
)
camera.position.fromArray(cameraConfig.position)

/* ---------------------------------------------------------- camera moves -- */

const HOME_TARGET = new THREE.Vector3().fromArray(cameraConfig.target)
const HOME_DIRECTION = new THREE.Vector3()
  .fromArray(cameraConfig.position)
  .sub(new THREE.Vector3().fromArray(cameraConfig.target))
  .normalize()

/*
 * Turntable lock: the figure may only spin left/right (azimuth). The polar
 * angle is frozen, so dragging up/down does nothing. minPolarAngle ===
 * maxPolarAngle is how OrbitControls expresses "no vertical orbit".
 *
 * ELEVATION_LIFT_DEG shifts the locked view off the config position, as if
 * the visitor grabbed it and tipped it. Positive = camera higher
 * (more top-down), negative = camera lower (more eye-level). Tweak this
 * one number to move the default tilt.
 */
const ELEVATION_LIFT_DEG = -10
const _basePolar = Math.acos(THREE.MathUtils.clamp(HOME_DIRECTION.y, -1, 1))
const FIXED_POLAR_ANGLE = THREE.MathUtils.clamp(
  _basePolar - THREE.MathUtils.degToRad(ELEVATION_LIFT_DEG),
  0.15,
  Math.PI / 2 - 0.02,
)
// Rebuild the home direction on the locked cone, keeping the same azimuth.
{
  const _az = Math.atan2(HOME_DIRECTION.x, HOME_DIRECTION.z)
  HOME_DIRECTION.set(
    Math.sin(_az) * Math.sin(FIXED_POLAR_ANGLE),
    Math.cos(FIXED_POLAR_ANGLE),
    Math.cos(_az) * Math.sin(FIXED_POLAR_ANGLE),
  ).normalize()
}

/* -------------------------------------------------------------- controls -- */

const controls = new OrbitControls(camera, canvas)
controls.target.copy(HOME_TARGET)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.enablePan = false
controls.rotateSpeed = 0.72
controls.zoomSpeed = 0.85
controls.minDistance = cameraConfig.minDistance
controls.maxDistance = cameraConfig.maxDistance
controls.minPolarAngle = FIXED_POLAR_ANGLE
controls.maxPolarAngle = FIXED_POLAR_ANGLE
/*
 * OrbitControls expresses autoRotate in "2π/60 per second" units, so 1.0 is
 * 6°/s. Idle spin pauses itself while the visitor drags; `userPaused` extends
 * that pause briefly afterwards so the scene holds still while they look.
 */
controls.autoRotate = false
controls.autoRotateSpeed = orbit.degreesPerSecond / 6
controls.update()

/* -------------------------------------------------------------- environment */

const environment = buildEnvironment(scene, renderer)

/* -------------------------------------------------------- credit links --- */

/*
 * The framed prints can carry a creator plaque (see WALL_PHOTO frames in
 * environment.js). A clean tap on one opens the creator's original post;
 * a drag still orbits.
 */
{
  const links = environment.creditLinks ?? []
  if (links.length > 0) {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    let downAt = null

    const pickLink = (event) => {
      const rect = canvas.getBoundingClientRect()
      ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      return raycaster.intersectObjects(links, false)[0]?.object ?? null
    }

    canvas.addEventListener('pointerdown', (event) => {
      downAt = { x: event.clientX, y: event.clientY }
    })
    // Listened on the window so a release just off the canvas still counts.
    window.addEventListener('pointerup', (event) => {
      const start = downAt
      downAt = null
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (dx * dx + dy * dy > 36) return
      const link = pickLink(event)
      if (link?.userData.creditUrl) window.open(link.userData.creditUrl, '_blank', 'noopener')
    })
    canvas.addEventListener('pointermove', (event) => {
      if (event.buttons !== 0 || downAt) return
      canvas.style.cursor = pickLink(event) ? 'pointer' : ''
    })
  }
}

/* ----------------------------------------------------------- post-processing */

/*
 * The composer renders into its own target, which does not inherit the
 * renderer's antialiasing — so the target is created multisampled. Without it
 * every patch and silhouette edge stair-steps.
 */
const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: 4,
})

const composer = new EffectComposer(renderer, composerTarget)
composer.addPass(new RenderPass(scene, camera))

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.42, // strength
  0.55, // radius
  1.0, // threshold — only true overexposure blooms
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

/* -------------------------------------------------------------- resize --- */

/*
 * The canvas is sized by CSS, so measure its box rather than the window.
 */
const resize = () => {
  const stage = canvas.parentElement
  const width = Math.max(1, stage.clientWidth)
  const height = Math.max(1, stage.clientHeight)
  const dpr = Math.min(window.devicePixelRatio, 1.75)

  camera.aspect = width / height
  camera.updateProjectionMatrix()

  renderer.setPixelRatio(dpr)
  renderer.setSize(width, height, false)
  composer.setPixelRatio(dpr)
  composer.setSize(width, height)
  bloom.setSize(width, height)

  // Keep the subject framed as the viewport changes, until the visitor takes over.
  if (!framingLocked && !tween && camera.position.lengthSq() > 0) refitDistance()
}

new ResizeObserver(resize).observe(canvas)
window.addEventListener('resize', resize)

/* --------------------------------------------- distance fit (uses controls) -- */

const HOME_POSITION = new THREE.Vector3()

/** Distance at which the subject box fits the current frustum with margin. */
function homeDistance() {
  const vFov = THREE.MathUtils.degToRad(camera.fov)
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
  const { height, width, margin } = cameraConfig.framing

  return Math.max(
    (height * margin) / (2 * Math.tan(vFov / 2)),
    (width * margin) / (2 * Math.tan(hFov / 2)),
  )
}

/**
 * Re-solves only the *distance*, keeping whatever orbit angle the camera is
 * currently at — so a resize reframes the subject without snapping the view
 * back mid-spin.
 */
function refitDistance() {
  const direction = camera.position.clone().sub(controls.target)
  if (direction.lengthSq() === 0) return
  camera.position
    .copy(controls.target)
    .addScaledVector(direction.normalize(), homeDistance())
  controls.update()
}

/* ------------------------------------------------------------ idle spin --- */

let userPaused = false
let placing = false
let focused = false
let resumeTimer = null
let framingLocked = false
let tween = null

const syncAutoRotate = () => {
  controls.autoRotate = orbit.enabled && !userPaused && !placing && !focused && !tween
}

// Once the visitor takes over, resizing must not yank the camera back.
controls.addEventListener('start', () => {
  framingLocked = true
  userPaused = true
  clearTimeout(resumeTimer)
  syncAutoRotate()
})

controls.addEventListener('end', () => {
  clearTimeout(resumeTimer)
  resumeTimer = setTimeout(() => {
    userPaused = false
    syncAutoRotate()
  }, orbit.resumeDelay * 1000)
})

syncAutoRotate()

/** Flies the camera to a position and look-at target. */
function tweenCamera(toPosition, toTarget, duration = 0.85) {
  tween = {
    elapsed: 0,
    duration,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: toPosition.clone(),
    toTarget: toTarget.clone(),
  }
  controls.enabled = false
  syncAutoRotate()
}

function resetCamera() {
  focused = false
  syncAutoRotate()
  HOME_POSITION.copy(HOME_TARGET).addScaledVector(HOME_DIRECTION, homeDistance())
  tweenCamera(HOME_POSITION, HOME_TARGET, 0.75)
}

/**
 * Pulls the camera in to a claimed spot on the body. Only the azimuth swings
 * (e.g. around behind the figure for a back zone) — the elevation stays on
 * the locked turntable angle so the view never tilts up/down.
 */
function focusZone(item) {
  if (!item) {
    resetCamera()
    return
  }

  focused = true
  syncAutoRotate()

  // Azimuth comes from the marker's surface normal, flattened to the ground
  // plane so no vertical tilt leaks in.
  const azimuth = item.worldNormal.clone()
  azimuth.y = 0
  if (azimuth.lengthSq() < 1e-8) {
    azimuth.copy(camera.position).sub(item.worldPoint)
    azimuth.y = 0
  }
  if (azimuth.lengthSq() < 1e-8) azimuth.set(0, 0, 1)
  azimuth.normalize()

  const dist = cameraConfig.focusDistance
  const to = item.worldPoint
    .clone()
    .addScaledVector(azimuth, Math.sin(FIXED_POLAR_ANGLE) * dist)
  to.y = item.worldPoint.y + Math.cos(FIXED_POLAR_ANGLE) * dist

  tweenCamera(to, item.worldPoint.clone(), 0.85)
}

function stepTween(delta) {
  if (!tween) return
  tween.elapsed += delta
  const t = Math.min(1, tween.elapsed / tween.duration)
  const eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

  camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased)
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased)
  controls.update()

  if (t >= 1) {
    tween = null
    controls.enabled = true
    userPaused = false
    syncAutoRotate()
  }
}

/* ----------------------------------------------------------------- boot --- */

let avatar = null
let studio = null
let panel = null

async function boot() {
  /*
   * The page comes up whole — HUD and arena — and only the figure waits on the
   * loader. The sponsors list opens from View sponsors; tapping a spot on the
   * body opens the bid dialog for that spot. The zone system is built before
   * the scan exists and is handed the avatar once it lands.
   */
  studio = new BrandSlots({ scene, camera, canvas })

  panel = initSponsors({ studio })

  studio.onChange(({ armed, focusedId }) => {
    // Hold the turntable still while a brand is being placed or a spot is open.
    placing = !!armed
    focused = !!focusedId
    syncAutoRotate()
  })

  // Clicking a spot on the body flies the camera in and opens its bid dialog.
  studio.onFocus((item) => focusZone(item))

  initHud({
    onResetCamera: resetCamera,
    onToggleSponsors: () => panel.openSponsors(),
  })

  setProgress(0.02, 'Loading the body…')

  // Brand catalogue loads alongside the scan so the spots build against the
  // database rows when the backend is on (baked-in rows otherwise).
  const catalog = fetchBrands().catch(() => null)

  try {
    avatar = await loadAvatar({
      onProgress: (fraction) => setProgress(0.02 + fraction * 0.82),
    })
  } catch (error) {
    progressLabel.textContent = 'Could not load the model — check that /elong.glb is being served.'
    progressPct.textContent = ''
    console.error(error)
    return
  }

  scene.add(avatar.group)

  setProgress(0.86, 'Indexing the body…')
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)))

  // Build the ray acceleration structure once, for every mesh in the scan.
  const started = performance.now()
  for (const mesh of avatar.meshes) mesh.geometry.computeBoundsTree()
  console.info(
    `[scan] BVH built over ${avatar.meshes.length} mesh(es) in ${Math.round(performance.now() - started)} ms`,
  )

  setProgress(0.98, 'Hanging the sponsor spots…')
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 30)))

  // Projects every zone onto the body (setAvatar also builds the markers).
  const rows = await catalog
  if (rows?.length) {
    replaceBrands(rows)
    // Buyer logos must be loaded before the markers build their textures —
    // an unloaded image falls back to the procedural glyph.
    await Promise.all(
      rows
        .filter((row) => row.logoUrl)
        .map(async (row) => {
          try {
            row.image = await loadBrandImage(row.logoUrl)
          } catch {
            // Missing logo: the glyph fallback stands in.
          }
        }),
    )
  }
  studio.setAvatar(avatar)

  // Sold spots persist for every visitor: print the top paid bid per spot
  // before handling the return, so a reload still shows the body correctly.
  try {
    await paintAllPaidBids(studio)
  } catch {
    // A missing backend must never block the body.
  }

  // Returning from Dodo checkout with ?bid=<id>: confirm payment and print
  // the winner's logo on the body (verify-payment reconciles directly with
  // Dodo when the webhook is late).
  settlePaymentReturn(studio)
    .then((bid) => {
      if (!bid) return
      studio.focus(bid.spot_id)
      panel.openSponsors()
      showToast(`Payment confirmed — the ${bid.spot_label} is yours.`)
    })
    .catch(() => {})

  setProgress(1, 'Ready')
  requestAnimationFrame(() => loader.classList.add('is-done'))
}

/* ---------------------------------------------------------------- frame --- */

const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)
  const delta = Math.min(clock.getDelta(), 0.1)

  stepTween(delta)
  // Passing delta keeps the idle spin frame-rate independent.
  if (!tween) controls.update(delta)
  composer.render()
}

window.addEventListener('beforeunload', () => {
  studio?.dispose()
  environment.dispose()
  composer.dispose()
  renderer.dispose()
})

/* Dev-only handle for inspecting the live scene from the console. */
const DEBUG = new URLSearchParams(location.search).has('debug')
if (DEBUG || import.meta.env?.DEV) {
  window.__viewer = {
    THREE,
    scene,
    camera,
    controls,
    canvas,
    renderer,
    composer,
    bloom,
    environment,
    relaxBloom() {
      bloom.strength = 0
    },
    /** Flat, neutral studio light for inspecting the raw scan. */
    inspect() {
      environment.root.visible = false
      scene.fog = null
      scene.background = new THREE.Color(0x555a60)
      for (const name of ['debug-ambient', 'debug-key', 'debug-fill']) {
        const existing = scene.getObjectByName(name)
        if (existing) existing.parent.remove(existing)
      }
      const ambient = new THREE.AmbientLight(0xffffff, 2.2)
      ambient.name = 'debug-ambient'
      const key = new THREE.DirectionalLight(0xffffff, 1.1)
      key.position.set(2.5, 3, 4)
      key.name = 'debug-key'
      const fill = new THREE.DirectionalLight(0xffffff, 0.7)
      fill.position.set(-3, 1.5, -3)
      fill.name = 'debug-fill'
      scene.add(ambient, key, fill)
      bloom.strength = 0
    },
    get studio() {
      return studio
    },
    /** The BrandSlots system: slot list, anatomy, and the layers on the body. */
    get brandSlots() {
      return studio
    },
    /** Landmarks measured from the scan, for verifying a placement. */
    get anatomy() {
      return studio?.anatomy ?? null
    },
    get avatar() {
      return avatar
    },
    /** Where the body actually lands on screen, in CSS pixels. */
    measure() {
      const box = new THREE.Box3().setFromObject(avatar.group)
      const project = (v) => {
        const p = v.clone().project(camera)
        return {
          x: Math.round(((p.x + 1) / 2) * canvas.clientWidth),
          y: Math.round(((1 - p.y) / 2) * canvas.clientHeight),
        }
      }

      // Project all eight bbox corners to get the on-screen bounds.
      const corners = []
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) corners.push(project(new THREE.Vector3(x, y, z)))
        }
      }

      const xs = corners.map((p) => p.x)
      const ys = corners.map((p) => p.y)

      return {
        stage: [canvas.parentElement.clientWidth, canvas.parentElement.clientHeight],
        canvas: [canvas.clientWidth, canvas.clientHeight],
        aspect: Number(camera.aspect.toFixed(3)),
        camera: camera.position.toArray().map((n) => Number(n.toFixed(3))),
        distance: Number(camera.position.distanceTo(controls.target).toFixed(3)),
        bbox: {
          min: box.min.toArray().map((n) => Number(n.toFixed(3))),
          max: box.max.toArray().map((n) => Number(n.toFixed(3))),
        },
        screen: {
          left: Math.min(...xs),
          right: Math.max(...xs),
          top: Math.min(...ys),
          bottom: Math.max(...ys),
          centerX: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        },
        headTop: project(new THREE.Vector3(0, box.max.y, 0)),
        feet: project(new THREE.Vector3(0, box.min.y, 0)),
        sponsorsOpen: !document.querySelector('#js-sponsorsmodal')?.hidden && document.querySelector('#js-sponsorsmodal')?.classList.contains('is-open'),
      }
    },
    /** Points the camera at the body from a given azimuth (degrees). Elevation stays locked. */
    look({ azimuth = 0, distance = 4.4, targetY = null } = {}) {
      const box = new THREE.Box3().setFromObject(avatar.group)
      const center = targetY === null ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3(0, targetY, 0)
      const a = THREE.MathUtils.degToRad(azimuth)
      camera.position.set(
        center.x + Math.sin(a) * Math.sin(FIXED_POLAR_ANGLE) * distance,
        center.y + Math.cos(FIXED_POLAR_ANGLE) * distance,
        center.z + Math.cos(a) * Math.sin(FIXED_POLAR_ANGLE) * distance,
      )
      controls.target.copy(center)
      controls.update()
      return { center: center.toArray().map((n) => Number(n.toFixed(3))) }
    },
  }
}

resize()
animate()
boot()

