/**
 * Works out which way the scanned body faces, using the texture atlas as the
 * landmark map: the face island sits around UV (0.80, 0.33) and the bare chest
 * around UV (0.40-0.55, 0.20-0.50). Averaging the positions and normals of the
 * vertices that sample those regions tells us the body's forward axis.
 */
import fs from 'node:fs'

const PATH = process.argv[2] ?? 'public/elong.glb'
const buffer = fs.readFileSync(PATH)

const jsonLength = buffer.readUInt32LE(12)
const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'))
const binStart = 20 + jsonLength + 8

const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const READERS = {
  5120: (b, o) => b.readInt8(o),
  5121: (b, o) => b.readUInt8(o),
  5122: (b, o) => b.readInt16LE(o),
  5123: (b, o) => b.readUInt16LE(o),
  5125: (b, o) => b.readUInt32LE(o),
  5126: (b, o) => b.readFloatLE(o),
}

function readAccessor(index) {
  const accessor = json.accessors[index]
  const view = json.bufferViews[accessor.bufferView]
  const components = COMPONENTS[accessor.type]
  const size = BYTES[accessor.componentType]
  const reader = READERS[accessor.componentType]
  const stride = view.byteStride || components * size
  const start = binStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)

  const out = new Float64Array(accessor.count * components)
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < components; c += 1) {
      out[i * components + c] = reader(buffer, start + i * stride + c * size)
    }
  }
  return out
}

const primitive = json.meshes[0].primitives[0]
const position = readAccessor(primitive.attributes.POSITION)
const uv = readAccessor(primitive.attributes.TEXCOORD_0)
const normal = readAccessor(primitive.attributes.NORMAL)
const count = json.accessors[primitive.attributes.POSITION].count

/** Mean position + normal of vertices whose UV falls inside a box. */
function probe(name, u0, u1, v0, v1) {
  let n = 0
  const meanPos = [0, 0, 0]
  const meanNormal = [0, 0, 0]

  for (let i = 0; i < count; i += 1) {
    const u = uv[i * 2]
    const v = uv[i * 2 + 1]
    if (u < u0 || u > u1 || v < v0 || v > v1) continue

    n += 1
    meanPos[0] += position[i * 3]
    meanPos[1] += position[i * 3 + 1]
    meanPos[2] += position[i * 3 + 2]
    meanNormal[0] += normal[i * 3]
    meanNormal[1] += normal[i * 3 + 1]
    meanNormal[2] += normal[i * 3 + 2]
  }

  if (!n) {
    console.log(`${name.padEnd(22)} no vertices`)
    return null
  }

  const pos = meanPos.map((v) => v / n)
  const nor = meanNormal.map((v) => v / n)
  const len = Math.hypot(...nor)
  const unit = nor.map((v) => v / len)

  console.log(
    `${name.padEnd(22)} verts=${String(n).padStart(7)}  ` +
      `pos=(${pos.map((v) => v.toFixed(3)).join(', ')})  ` +
      `normal=(${unit.map((v) => v.toFixed(3)).join(', ')})  ` +
      `|n|=${len.toFixed(3)}`,
  )
  return { pos, unit, n }
}

console.log(`vertices: ${count}\n`)

probe('all', 0, 1, 0, 1)
probe('face (u.80 v.33)', 0.74, 0.89, 0.26, 0.47)
probe('head side (u.13 v.19)', 0.06, 0.28, 0.12, 0.30)
probe('chest (u.40 v.25)', 0.36, 0.46, 0.18, 0.34)
probe('abdomen (u.40 v.45)', 0.34, 0.46, 0.38, 0.52)
probe('back of torso', 0.31, 0.7, 0.43, 0.62)
probe('thigh', 0.5, 0.94, 0.5, 0.95)

/* Geometric sanity: which axis is up, and how tall is the body? */
let minY = Infinity
let maxY = -Infinity
let minX = Infinity
let maxX = -Infinity
let minZ = Infinity
let maxZ = -Infinity
for (let i = 0; i < count; i += 1) {
  const x = position[i * 3]
  const y = position[i * 3 + 1]
  const z = position[i * 3 + 2]
  if (y < minY) minY = y
  if (y > maxY) maxY = y
  if (x < minX) minX = x
  if (x > maxX) maxX = x
  if (z < minZ) minZ = z
  if (z > maxZ) maxZ = z
}
console.log(
  `\nbounds  x[${minX.toFixed(3)}, ${maxX.toFixed(3)}]  ` +
    `y[${minY.toFixed(3)}, ${maxY.toFixed(3)}]  ` +
    `z[${minZ.toFixed(3)}, ${maxZ.toFixed(3)}]`,
)
console.log(`extent  X=${(maxX - minX).toFixed(3)} Y=${(maxY - minY).toFixed(3)} Z=${(maxZ - minZ).toFixed(3)}`)
