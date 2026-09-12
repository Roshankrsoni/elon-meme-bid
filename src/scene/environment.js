import * as THREE from 'three'

/**
 * Builds the dark neon arena the bust is projected into: gradient sky, fading
 * floor grid, octagonal pillar ring, glowing horizon line, the dais, and all
 * lights.
 *
 * Dimensions are in metres and are scaled around the subject — a ~1.12 m bust
 * whose torn hem hovers at `model.baseY`.
 */

export const ARENA = {
  floorRadius: 4.4,
  wallRadius: 3.7,
  wallHeight: 3.6,
  pillarCount: 10,
  pillarRadius: 3.3,
  pillarHeight: 2.8,
  pedestalRadius: 0.44,
}

const CYAN = 0x1fd6f0
const CYAN_HI = 0x3fe9ff
const PINK = 0xf06ea0

/* ---------------------------------------------------------------- sky ---- */

function buildSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x04070d) },
      midColor: { value: new THREE.Color(0x0d1724) },
      bottomColor: { value: new THREE.Color(0x020407) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 bottomColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y * 0.5 + 0.5;
        vec3 col = mix(bottomColor, midColor, smoothstep(0.0, 0.55, h));
        col = mix(col, topColor, smoothstep(0.5, 1.0, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  })

  const sky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), material)
  sky.name = 'sky'
  return sky
}

/* --------------------------------------------------------------- grid ---- */

/**
 * The floor grid is baked into a texture rather than drawn as line segments:
 * 1 px GL lines collapse into the dark floor at grazing angles, whereas a
 * radially faded map stays legible and antialiased.
 */
function gridTexture({ resolution = 2048, divisions = 44, color = CYAN }) {
  const canvas = document.createElement('canvas')
  canvas.width = resolution
  canvas.height = resolution
  const ctx = canvas.getContext('2d')

  const tint = new THREE.Color(color)
  ctx.strokeStyle = `rgb(${Math.round(tint.r * 255)}, ${Math.round(tint.g * 255)}, ${Math.round(tint.b * 255)})`
  ctx.lineWidth = 2.6

  const step = resolution / divisions
  for (let i = 0; i <= divisions; i += 1) {
    const p = i * step
    ctx.beginPath()
    ctx.moveTo(p, 0)
    ctx.lineTo(p, resolution)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, p)
    ctx.lineTo(resolution, p)
    ctx.stroke()
  }

  /*
   * Radial alpha profile: gentle, and always fading outward — a profile that
   * brightens toward the wall reads as a hard seam on the floor.
   */
  const fade = ctx.createRadialGradient(
    resolution / 2,
    resolution / 2,
    resolution * 0.04,
    resolution / 2,
    resolution / 2,
    resolution * 0.5,
  )
  fade.addColorStop(0, 'rgba(0,0,0,0.08)')
  fade.addColorStop(0.28, 'rgba(0,0,0,0.3)')
  fade.addColorStop(0.55, 'rgba(0,0,0,0.92)')
  fade.addColorStop(0.8, 'rgba(0,0,0,0.4)')
  fade.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.globalCompositeOperation = 'destination-in'
  ctx.fillStyle = fade
  ctx.fillRect(0, 0, resolution, resolution)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 16
  return texture
}

function buildGrid(size) {
  const grid = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({
      map: gridTexture({}),
      transparent: true,
      // Kept under the hologram in the lighting hierarchy.
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  )
  grid.rotation.x = -Math.PI / 2
  grid.position.y = 0.006
  grid.name = 'floor-grid'
  return grid
}

/* ---------------------------------------------------------------- ring ---- */

function buildRing({ radius, tube, y, color, opacity = 1, intensity = 1.6 }) {
  const geometry = new THREE.TorusGeometry(radius, tube, 8, 220)
  const material = new THREE.MeshBasicMaterial({
    // Push above 1.0 so the bloom pass actually catches the line.
    color: new THREE.Color(color).multiplyScalar(intensity),
    transparent: opacity < 1,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = y
  return ring
}

/* ------------------------------------------------------------ pillars ---- */

function buildPillars() {
  const group = new THREE.Group()
  group.name = 'pillars'

  const count = ARENA.pillarCount
  const pillarGeo = new THREE.BoxGeometry(0.4, ARENA.pillarHeight, 0.4)
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x1b2735,
    roughness: 0.55,
    metalness: 0.45,
    emissive: new THREE.Color(CYAN).multiplyScalar(0.1),
  })
  const edgeGeo = new THREE.EdgesGeometry(pillarGeo)
  const edgeMat = new THREE.LineBasicMaterial({
    color: new THREE.Color(CYAN).multiplyScalar(1.1),
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + Math.PI / count
    const x = Math.cos(angle) * ARENA.pillarRadius
    const z = Math.sin(angle) * ARENA.pillarRadius

    const pillar = new THREE.Mesh(pillarGeo, pillarMat)
    pillar.position.set(x, ARENA.pillarHeight / 2, z)
    pillar.lookAt(0, ARENA.pillarHeight / 2, 0)
    group.add(pillar)

    const edges = new THREE.LineSegments(edgeGeo, edgeMat)
    edges.position.copy(pillar.position)
    edges.rotation.copy(pillar.rotation)
    group.add(edges)

    // Horizontal light bands break up the slab into architecture.
    for (const height of [0.7, 1.6, 2.45]) {
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.045),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(CYAN_HI).multiplyScalar(1.2),
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      )
      band.position.set(x, height, z)
      band.lookAt(0, height, 0)
      group.add(band)
    }

    // Cap highlight so the columns terminate rather than run off the top.
    const cap = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.44),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CYAN_HI).multiplyScalar(1.1),
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    cap.rotation.x = -Math.PI / 2
    cap.position.set(x, ARENA.pillarHeight + 0.002, z)
    group.add(cap)

    // Floor anchor glow so the pillars don't read as floating wires.
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 1.5),
      new THREE.MeshBasicMaterial({
        map: radialTexture('rgba(63,233,255,0.6)'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.set(x, 0.006, z)
    group.add(glow)

    // Short strip of light where the pillar meets the floor.
    const foot = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.5),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CYAN_HI).multiplyScalar(1.4),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    foot.rotation.x = -Math.PI / 2
    foot.position.set(x, 0.012, z)
    group.add(foot)
  }

  return group
}

/* ----------------------------------------------------- wall door frames ---- */

function buildWallFrames() {
  const group = new THREE.Group()
  group.name = 'wall-frames'
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color(0x2a86a8),
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
    const radius = ARENA.wallRadius - 0.05
    const w = 2.35
    const h = 3.5
    const hw = w / 2

    const pts = [
      [-hw, 0], [hw, 0], [hw, h], [-hw, h],
    ]
    const positions = []
    for (let s = 0; s < pts.length; s += 1) {
      const [x1, y1] = pts[s]
      const [x2, y2] = pts[(s + 1) % pts.length]
      positions.push(x1, y1, 0, x2, y2, 0)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const frame = new THREE.LineSegments(geometry, material)
    frame.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    frame.lookAt(0, 0, 0)
    group.add(frame)
  }

  return group
}

/**
 * The occlusion pool under the figure. Its own profile rather than the glow
 * helper: a contact shadow needs a dense core and a fast falloff, which is the
 * opposite of a light bloom.
 */
const shadowCache = new Map()

function shadowTexture() {
  if (shadowCache.has('shadow')) return shadowCache.get('shadow')

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(0, 0, 0, 1)')
  g.addColorStop(0.3, 'rgba(0, 0, 0, 0.94)')
  g.addColorStop(0.52, 'rgba(0, 0, 0, 0.6)')
  g.addColorStop(0.74, 'rgba(0, 0, 0, 0.22)')
  g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  shadowCache.set('shadow', texture)
  return texture
}

/**
 * A vertical gradient for the wall: a lit band at eye level falling away to
 * near-black at the floor, so the backdrop reads as depth rather than fill.
 */
const wallCache = new Map()

function wallTexture() {
  if (wallCache.has('wall')) return wallCache.get('wall')

  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createLinearGradient(0, 256, 0, 0)
  gradient.addColorStop(0, 'rgba(6, 12, 20, 1)')
  gradient.addColorStop(0.28, 'rgba(30, 52, 74, 1)')
  gradient.addColorStop(0.6, 'rgba(20, 38, 56, 1)')
  gradient.addColorStop(1, 'rgba(6, 11, 18, 1)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 4, 256)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  wallCache.set('wall', texture)
  return texture
}

/**
 * An enclosing dark wall. Without it the floor's far edge hangs in mid-air and
 * the horizon line reads as a floating ring.
 */
function buildWall() {
  const group = new THREE.Group()
  group.name = 'wall'

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA.wallRadius, ARENA.wallRadius, ARENA.wallHeight, 64, 1, true),
    new THREE.MeshStandardMaterial({
      map: wallTexture(),
      color: 0x1a2a3c,
      roughness: 0.9,
      metalness: 0.1,
      side: THREE.BackSide,
      emissive: new THREE.Color(0x0a1a24),
    }),
  )
  wall.position.y = ARENA.wallHeight / 2
  group.add(wall)

  // A highlight along the wall's top edge.
  group.add(buildRing({ radius: ARENA.wallRadius - 0.02, tube: 0.007, y: ARENA.wallHeight - 0.05, color: CYAN, opacity: 0.28 }))

  return group
}

/* ------------------------------------------------------------ texture ---- */

const radialCache = new Map()

/** Soft radial-gradient sprite used for glows and the ground light pool. */
export function radialTexture(inner, outer = 'rgba(0,0,0,0)') {
  const key = `${inner}|${outer}`
  if (radialCache.has(key)) return radialCache.get(key)

  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.55, inner.replace(/[\d.]+\)$/, '0.18)'))
  gradient.addColorStop(1, outer)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  radialCache.set(key, texture)
  return texture
}

/* ------------------------------------------------------------- dais ------ */

function buildPedestal() {
  const group = new THREE.Group()
  group.name = 'pedestal'

  /*
   * The platform surface sits at the height where the figure's hem dissolve
   * finishes, so the semi-transparent part of the body is always below the
   * platform and therefore hidden by it. That is what makes the bust read as
   * standing on the dais instead of sinking through it.
   */
  const TOP = 0.06
  const BOTTOM = -0.16

  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(
      ARENA.pedestalRadius,
      ARENA.pedestalRadius * 1.04,
      TOP - BOTTOM,
      80,
    ),
    new THREE.MeshStandardMaterial({
      color: 0x0a1017,
      roughness: 0.62,
      metalness: 0.18,
      emissive: new THREE.Color(CYAN).multiplyScalar(0.02),
    }),
  )
  disc.position.y = (TOP + BOTTOM) / 2
  group.add(disc)

  // The face stays genuinely dark — the bright rim is what should read.
  const top = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.pedestalRadius, 80),
    new THREE.MeshStandardMaterial({
      color: 0x0a131d,
      roughness: 0.5,
      metalness: 0.2,
      emissive: new THREE.Color(CYAN).multiplyScalar(0.015),
    }),
  )
  top.rotation.x = -Math.PI / 2
  top.position.y = TOP
  group.add(top)

  // A soft occlusion pool under the figure. Without it the platform reads
  // brighter directly beneath the body than beside it, which floats the figure.
  const shadowSize = ARENA.pedestalRadius * 2.05
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(shadowSize, shadowSize),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  )
  contact.rotation.x = -Math.PI / 2
  // Lifted clear of the dais face, or the two planes z-fight at grazing angles.
  contact.position.y = TOP + 0.012
  group.add(contact)

  // A crisp rim is what actually sells it as a platform edge.
  group.add(buildRing({ radius: ARENA.pedestalRadius * 0.995, tube: 0.006, y: TOP + 0.004, color: CYAN_HI, intensity: 2.4 }))

  return group
}

/* -------------------------------------------------------- environment ---- */

/**
 * A tiny emissive room baked into a PMREM cube map. The scan's metalness comes
 * straight from its roughness/metalness texture, so without this the body
 * renders as a black mirror.
 */
function buildEnvironmentMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const scene = new THREE.Scene()

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(12, 8, 12),
    new THREE.MeshBasicMaterial({ color: 0x0a121c, side: THREE.BackSide }),
  )
  scene.add(box)

  const panel = (w, h, color, intensity, position, rotation) => {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) }),
    )
    mesh.position.set(...position)
    mesh.rotation.set(...rotation)
    scene.add(mesh)
  }

  // Key from above, cyan strips on the sides, warm bounce at the front.
  panel(8, 8, 0xffffff, 0.5, [0, 3.9, 0], [Math.PI / 2, 0, 0])
  panel(7, 2.4, CYAN_HI, 1.5, [-5.9, 1.5, 0], [0, Math.PI / 2, 0])
  panel(7, 2.4, CYAN, 1.2, [5.9, 1.5, 0], [0, -Math.PI / 2, 0])
  panel(6, 2, 0xffd6ad, 0.5, [0, 1.4, 5.9], [0, Math.PI, 0])
  panel(6, 1.6, 0x8fd8ff, 0.9, [0, 1.2, -5.9], [0, 0, 0])

  const target = pmrem.fromScene(scene, 0.03)
  pmrem.dispose()
  scene.traverse((child) => {
    if (child.isMesh) {
      child.geometry.dispose()
      child.material.dispose()
    }
  })

  return target.texture
}

/* ---------------------------------------------------------------- build --- */

export function buildEnvironment(scene, renderer) {
  scene.fog = new THREE.FogExp2(0x04070c, 0.052)

  const root = new THREE.Group()
  root.name = 'environment'

  root.add(buildSky())
  root.add(buildWall())
  root.add(buildWallFrames())
  root.add(buildPillars())
  root.add(buildPedestal())

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA.floorRadius, 128),
    new THREE.MeshStandardMaterial({
      color: 0x070c14,
      roughness: 0.3,
      metalness: 0.92,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.name = 'floor'
  root.add(floor)

  root.add(buildGrid(ARENA.floorRadius * 2))

  /*
   * The floor/wall junction is drawn as a thin band hugging the wall rather
   * than a floating torus, so it reads as one straight architectural line.
   */
  const junction = new THREE.Mesh(
    new THREE.CylinderGeometry(ARENA.wallRadius - 0.02, ARENA.wallRadius - 0.02, 0.026, 64, 1, true),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(CYAN_HI).multiplyScalar(1.5),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  )
  junction.position.y = 0.016
  root.add(junction)

  scene.add(root)

  /* ---- lights ---- */

  const lights = new THREE.Group()
  lights.name = 'lights'

  /*
   * The figure is lit to read as a photographed person, not a neon object. The
   * cyan points are deliberately weak and desaturated — the arena's neon comes
   * from its emissive geometry, which costs the skin nothing.
   */
  const ambient = new THREE.AmbientLight(0xffe9dc, 0.55)

  // The key carries the form; it stays warm so skin keeps its red.
  const key = new THREE.DirectionalLight(0xffe4c8, 0.8)
  key.position.set(2.2, 3.2, 2.8)

  const fill = new THREE.DirectionalLight(0xe8eef2, 0.42)
  fill.position.set(-2.4, 1.6, 1.8)

  // A frontal lift at face height — without it the head sits a stop under the
  // chest, which is the wrong way round for a portrait.
  const face = new THREE.DirectionalLight(0xffe0c8, 1.85)
  face.position.set(0.5, 1.1, 3.2)

  // The cyan points only kiss the silhouette now.
  const rimA = new THREE.PointLight(0x7fc4d6, 0.7, 4, 2)
  rimA.position.set(-1.7, 1.7, -1.4)

  const rimB = new THREE.PointLight(0x7fc4d6, 0.55, 4, 2)
  rimB.position.set(1.8, 1.1, -1.5)

  const kicker = new THREE.PointLight(PINK, 0.5, 2.2, 2)
  kicker.position.set(0.9, 0.4, 1.0)

  const bounce = new THREE.HemisphereLight(0xb0b6ba, 0x0a0d12, 0.3)

  lights.add(ambient, key, fill, face, rimA, rimB, kicker, bounce)
  scene.add(lights)

  const envMap = buildEnvironmentMap(renderer)
  scene.environment = envMap
  scene.environmentIntensity = 0.6

  return {
    root,
    envMap,
    lights: { ambient, key, rimA, rimB, kicker, bounce },
    dispose() {
      root.traverse((child) => {
        if (child.isMesh || child.isLine || child.isLineSegments) {
          child.geometry?.dispose()
          const material = child.material
          if (Array.isArray(material)) material.forEach((m) => m.dispose())
          else material?.dispose()
        }
      })
      scene.remove(root, lights)
      envMap.dispose()
    },
  }
}
