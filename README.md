# Sponsor My Body

A dark-neon product page where a scanned athlete is presented as a hologram and
visitors place their own brand patches directly onto the body.

Built with **three.js** (loaded from npm, bundled by Vite) and the scan in
`public/elong.glb`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm run build        # writes dist/
npm run preview      # serve the built site
```

## What's here

**The stage** — `src/scene/environment.js` builds the arena: a gradient sky, an
enclosing dark wall, an octagonal ring of lit pillars, a radially faded floor
grid, a glowing dais, and the camera-facing light column the figure rises out of.

**The figure** — `src/scene/model.js` loads the scan and normalises it from its
measured bounding box: centred on the origin, `model.height` metres tall, its hem
hovering `model.baseY` above the dais. Two details worth knowing:

- The scan's root node carries a `0.009375` scale, leaving the mesh 7.5 cm tall,
  so nothing here hard-codes a size — everything is derived from the bounds.
- The material's metalness and roughness both come from a packed ORM texture at
  factor 1. Without the environment map built in `environment.js` the body
  renders as a black mirror.

**The patches** — `src/ui/patches.js` draws every patch on a canvas at runtime,
so the project ships with no branding assets of its own. `src/scene/stickers.js`
places them:

1. A click raycasts the body and takes the hit point and surface normal.
2. A quad is built in the avatar's local space and **bent onto the skin**: each
   grid vertex is cast along the surface normal and pulled onto the first face it
   meets, so a flat decal cannot sink into a curved chest.
3. Two guards keep a placement honest. A vertex is only accepted if it lands
   within `width * 0.25` of the tangent plane *and* its face points roughly the
   same way as the hit — that is what stops a patch from jumping onto a hand in
   front of the belly. If too little of the quad lands on the body
   (`placement.minCoverage`), the placement is refused with a message.

The scan is ~2M triangles, so a plain `Raycaster` costs tens of milliseconds per
ray and conforming a patch needs ~340 of them. `three-mesh-bvh` is therefore not
optional: it is patched onto `Mesh`/`BufferGeometry` at the top of
`stickers.js` and the tree is built once during the loading screen.

**The HUD** — `src/ui/hud.js` drives the countdown, the live ticker, the watchers
counter and the stream controls. `src/ui/placeholders.js` draws the profile
avatar and the second camera tile as canvases, since the reference design's
photography is not part of this repo.

## Editing it

Almost everything a non-developer would touch is in **`src/config.js`**:

| Field | Effect |
| --- | --- |
| `site.*` | headline copy, earnings figure, countdown, watcher count |
| `leaderboard` | the live-activity rows |
| `model.height` / `model.baseY` | how tall the bust is and how high it floats |
| `model.yaw` | which way the body faces |
| `camera.*` | framing box the camera solves its distance from |
| `placement.*` | patch size limits, surface offset, the coverage guard |

Framing is aspect-aware: `homeDistance()` in `src/main.js` pulls the camera back
far enough to fit `camera.framing` on any viewport, so the subject never crops on
a wide, tall, or studio-narrowed window.

### Swapping the model

Drop a new file in `public/`, point `model.url` at it, and rebuild the loading
call. Nothing else assumes a size. If the new mesh faces a different way, run the
bundled analysis to find out which:

```bash
node scripts/analyze-orientation.mjs public/your-model.glb
```

It probes the mesh using the base-colour atlas as a landmark map (the face and
chest islands sit at known UV coordinates) and prints the mean position and
normal of each probe, plus the true bounds and up-axis.

## About the asset

`elong.glb` is a raw photogrammetry capture: one mesh, ~1.02M vertices and 2M
triangles, with two 8K JPEG maps. **It is a bust** — it runs from the top of the
head to mid-thigh and has no legs, knees, shins, feet or shoes; the mesh ends in
a torn, open hem. The arms and hands are complete.

Because a figure with no legs cannot stand on a dais, the page leans into it: the
bottom ~30 cm of the body **dissolves into cyan on a scanline pattern**, with an
alpha fade injected into the standard material's shader (see `applyHoloFade` in
`src/scene/model.js`). The ragged hem is therefore never visible, and the cut
reads as a projection rather than missing geometry. A cyan fresnel rim on the
silhouette sells the rest.

The bust is also displayed at life scale for what it is — ~1.12 m for a
head-to-mid-thigh span — which is what makes the centimetre patch sizes in the
UI mean something on screen.

## Not built yet

This is the front end only. There is no backend, no accounts, no bidding, no
payment and no persistence — placed patches live in memory and are gone on
reload. Patch artwork is generated procedurally and uploaded logos are read on
the client with `URL.createObjectURL`; nothing is uploaded anywhere.

## Project layout

```
index.html               markup + all HUD overlays
src/main.js              renderer, camera, bloom, resize, boot
src/config.js            copy and tunables
src/scene/environment.js arena, dais, beam, lights, environment map
src/scene/model.js       scan loading, normalisation, holographic fade
src/scene/stickers.js    BVH raycasting and the patch placement engine
src/ui/patches.js        procedural patch artwork
src/ui/panel.js          Brand studio wiring
src/ui/hud.js            countdown, ticker, HUD controls
src/ui/placeholders.js   canvas-drawn avatar and camera tile
src/styles/main.css      the whole visual system
scripts/                 model analysis helper
public/elong.glb         the scan
```

Loading `?debug=1` exposes a dev-only `window.__viewer` handle with
`measure()`, `look()` and `inspect()` helpers for poking at the live scene.
