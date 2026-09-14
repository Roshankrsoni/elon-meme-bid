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

**The patches** — `src/ui/patches.js` draws every slot's artwork on a canvas at
runtime, so the project ships with no branding assets of its own:

- Torso slots are the reference's sticker: one flat fill (acid lime, or orange
  for the hero slot), rounded corners, a fine white dashed ring hugging the
  silhouette, and exactly one mark inside it — a hand-drawn glyph or a code.
  Nothing else is printed on them, so the mark is the only thing that reads at
  a few centimetres across.
- Limb slots carry text instead. Each one is a strap split along its length into
  two columns of type set on the limb's axis: the brand in ink on the fill, the
  model inverted (white on black) beside it. A hero-coloured strap keeps both
  columns in its own colour.

The same artwork drives the sponsor rows (`logoDataUrl`), so
the list and the body read as one system.

**The brand slots** — the scan is an unskinned, unnamed photogrammetry mesh, so
there are no bones or semantic node names to place a logo against. Two modules
solve that:

- `src/scene/anatomy.js` measures the body from its own vertices: the up axis,
  the direction the chest and face point, and the landmarks (shoulder line,
  pectoral bulge, waist, hip) plus per-height silhouette widths. Nothing assumes
  a fixed X/Y/Z convention. On this scan it recovers `up = +Y`, `front = +Z`,
  `left = +X`, a shoulder line at 0.77 of the bust and the pectorals at 0.60.
- `src/scene/brandSlots.js` expresses the eleven slots as *anatomical* requests —
  a lateral offset, a height fraction and an outward facing direction — then
  resolves each one onto the real surface:

1. A ray is cast inward along the slot's own facing direction from a point
   outside the body. A short tangential sweep picks the most squarely-facing
   surface near the nominal spot, so a slot lands on the flat of a pec or the
   outside of a biceps rather than on a crease. Limb slots carry a lateral guard
   so they cannot fold back onto the ribcage.
2. The quad is built in the avatar's local space and **bent onto the skin**:
   each grid vertex is cast along the surface normal and pulled onto the first
   face it meets, so a flat decal cannot sink into a curved chest.
3. Two guards keep a placement honest. A vertex is only accepted if it lands
   within `width * 0.25` of the tangent plane *and* its face points roughly the
   same way as the hit — that is what stops a patch from jumping onto a hand in
   front of the belly. If too little of the quad lands on the body
   (`placement.minCoverage`), the placement is refused with a message.

The result is eleven nodes under one `BrandSlots` group, parented to the avatar
so they rotate with the body:

```
BrandSlots
├── Chest_Left      ├── Shoulder_Left     ├── Back_Left
├── Chest_Right     ├── Shoulder_Right    ├── Back_Right
├── UpperArm_Left   ├── Forearm_Left      └── Back_Waist
├── UpperArm_Right  ├── Forearm_Right
```

Each node carries a `slotId` and is independently selectable, re-sized and
re-brandable at runtime.

The scan is ~2M triangles, so a plain `Raycaster` costs tens of milliseconds per
ray and conforming a slot needs ~340 of them. `three-mesh-bvh` is therefore not
optional: it is patched onto `Mesh`/`BufferGeometry` at the top of
`brandSlots.js` and the tree is built once during the loading screen.

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
a wide, tall, or narrow window.

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

## Bidding backend (Supabase + Dodo Payments)

Bids are real once this is wired up. Until then the page runs fine — the bid
form just explains that bidding is switched off.

**How a bid flows:** the buyer fills brand name, email, product URL and logo
in the bid dialog → the logo uploads to the `brand-logos` storage bucket →
a `pending` row lands in `bids` → the `create-checkout` edge function mints a
one-time Dodo product at the exact bid amount and returns a hosted checkout
URL → Dodo redirects back to `/?bid=<id>` → the `dodo-webhook` marks the bid
`paid` → the client prints the winner's logo on the body (top paid bid wins).

1. **Supabase project** — create one, then run the migrations in order in
   the SQL editor: `supabase/migrations/0001_bids.sql` (bids table, RLS,
   `brand-logos` bucket), `0002_leaderboard.sql` (leaderboard view),
   `0003_catalog.sql` (brands + ticker countries seed data).
2. **Edge functions** — dashboard → Edge Functions → New function, paste
   `supabase/functions/create-checkout/index.ts` and
   `supabase/functions/dodo-webhook/index.ts`. Secrets for both:
   `DODO_API_KEY`, `DODO_ENV=test` (or `live`).
   Extra secret for `dodo-webhook`: `DODO_WEBHOOK_SECRET` (from the webhook
   endpoint's Overview tab in the Dodo dashboard).
3. **Dodo webhook** — dashboard → Developer → Webhooks, endpoint
   `https://<project-ref>.supabase.co/functions/v1/dodo-webhook`,
   subscribed to `payment.succeeded`, `payment.failed`, `payment.cancelled`.
4. **Frontend keys** — copy `.env.example` to `.env` with
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Test mode first:
   Dodo test cards, `DODO_ENV=test`.
5. Amounts are USD cents; every checkout creates one throwaway Dodo product
   per bid (auction prices can't come from a fixed catalogue). Starting bids
   are per spot — chest 1–2 and back 6–7 open at $100, arms 3–5 at $50, the
   lower-back banner 8 at $120 (`minBid` in `brandSlotDefs`, mirrored in
   `create-checkout`, backstopped by migration `0007` at the $50 global floor).

## Not built yet

Local placements still live in memory and are gone on reload; only bids that
go through checkout persist (in Supabase). There are no accounts — email is
collected per bid for the receipt. Patch artwork is generated procedurally;
buyer logos upload to Supabase storage and are printed contain-fit on the
winning sticker.

## Project layout

```
index.html               markup + all HUD overlays
src/main.js              renderer, camera, bloom, resize, boot
src/config.js            copy and tunables
src/lib/supabase.js      Supabase client (null until .env keys exist)
src/lib/bidding.js       bid records, logo upload, checkout, return settlement
src/scene/environment.js arena, dais, beam, lights, environment map
src/scene/model.js       scan loading, normalisation, holographic fade
src/scene/anatomy.js     measures the body's axes and anatomical landmarks
src/scene/brandSlots.js  the eleven brand slots, BVH raycasting and decal fitting
src/ui/patches.js        procedural patch artwork
src/ui/panel.js          sponsors list + bid dialog wiring
src/ui/hud.js            countdown, ticker, HUD controls
src/ui/placeholders.js   canvas-drawn avatar and camera tile
src/styles/main.css      the whole visual system
scripts/                 model analysis helper
public/elong.glb         the scan
```

Loading `?debug=1` exposes a dev-only `window.__viewer` handle with
`measure()`, `look()` and `inspect()` helpers for poking at the live scene.
