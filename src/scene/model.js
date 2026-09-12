import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { model as config } from '../config.js'

/**
 * The scan is a bust: the mesh ends in a ragged, open hem at mid-thigh. Rather
 * than fight that, the bottom of the body is dissolved into cyan so the cut
 * reads as a holographic projection instead of missing geometry.
 *
 * Implemented as a world-space height fade injected into the standard material,
 * so the scan's PBR maps keep working untouched.
 */
function applyHoloFade(material) {
  material.transparent = true
  material.depthWrite = true

  material.onBeforeCompile = (shader) => {
    // Starting the fade slightly above the hem means the ragged, open mesh
    // boundary is fully transparent and never shows as a torn edge.
    const bottom = config.baseY + config.fadeOffset
    shader.uniforms.uHoloBottom = { value: bottom }
    shader.uniforms.uHoloTop = { value: bottom + config.fadeHeight }
    shader.uniforms.uHoloBand = { value: config.fadeBand }

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHoloY;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n\tvHoloY = ( modelMatrix * vec4( transformed, 1.0 ) ).y;',
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying float vHoloY;',
          'uniform float uHoloBottom;',
          'uniform float uHoloTop;',
          'uniform float uHoloBand;',
        ].join('\n'),
      )
      .replace(
        '#include <dithering_fragment>',
        [
          // A fine vertical scan modulates the cut line, and its banding is
          // gated to the dissolve itself — otherwise the stripe pattern tiles
          // the entire body and reads as moiré.
          'float holoScan = 0.5 + 0.5 * sin( vHoloY * 520.0 );',
          'float holoCut = uHoloBottom + holoScan * uHoloBand;',
          'float holoFade = smoothstep( holoCut, uHoloTop, vHoloY );',
          'float holoGate = 1.0 - holoFade;',
          'holoFade *= mix( 1.0, mix( 0.4, 1.0, holoScan ), holoGate );',
          'gl_FragColor.a *= holoFade;',
          // Only enough glow to sell the cut — the body itself stays unlit neon-free.
          'gl_FragColor.rgb += vec3( 0.04, 0.3, 0.38 ) * pow( holoGate, 1.8 ) * 1.1;',
          '#include <dithering_fragment>',
        ].join('\n'),
      )
  }
  material.needsUpdate = true
}

/**
 * Loads the photogrammetry scan and normalises it into scene space:
 * centred on the origin, exactly `config.height` metres tall, its hem hovering
 * at `config.baseY` above the dais.
 *
 * The source file is a raw scan (~2M triangles, two 8K JPEG maps) whose root
 * node carries a 0.009375 scale, leaving it 7.5 cm tall. Everything here is
 * derived from the measured bounding box, so it survives a model swap.
 */
export function loadAvatar({ onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader()

    loader.load(
      config.url,
      (gltf) => {
        const source = gltf.scene

        const box = new THREE.Box3().setFromObject(source)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        /*
         * Normalise on the *inner* node, not the wrapper: Object3D matrices are
         * composed as T·R·S, so a child's own position is not affected by its
         * own scale. Setting both explicitly gives scale·(v − center).
         * The wrapper then stays at unit scale, which means stickers parented
         * to it keep working in real metres.
         */
        const scale = config.height / size.y
        source.scale.setScalar(scale)
        source.position.copy(center).multiplyScalar(-scale)

        const group = new THREE.Group()
        group.name = 'avatar'
        group.add(source)
        // The hem hovers above the dais; the scan has no legs to stand on.
        group.position.y = config.baseY + config.height / 2
        group.rotation.y = config.yaw
        group.updateMatrixWorld(true)

        const meshes = []

        source.traverse((child) => {
          if (!child.isMesh) return
          meshes.push(child)
          child.castShadow = false
          child.receiveShadow = false
          child.frustumCulled = true

          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) {
            if (!material) continue
            material.envMapIntensity = config.envIntensity
            material.metalness = Math.min(material.metalness ?? 1, config.maxMetalness)
            // The scan bakes its own lighting; keep it from blowing out.
            material.roughness = Math.max(material.roughness ?? 1, config.minRoughness)
            applyHoloFade(material)
            material.needsUpdate = true
          }
        })

        resolve({
          group,
          meshes,
          size,
          scale,
          dispose() {
            for (const mesh of meshes) {
              mesh.geometry?.dispose()
              const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
              for (const material of materials) {
                if (!material) continue
                material.map?.dispose()
                material.metalnessMap?.dispose()
                material.roughnessMap?.dispose()
                material.normalMap?.dispose()
                material.dispose()
              }
            }
          },
        })
      },
      (event) => {
        if (!onProgress) return
        const total = event.total || 0
        onProgress(total ? Math.min(1, event.loaded / total) : 0, event.loaded, total)
      },
      reject,
    )
  })
}
