/**
 * Page copy + tunables. Everything a non-developer would want to edit lives here.
 */

export const site = {
  earnings: '$112,058',
  biddingLabel: 'Bidding closed',
  raceOffset: { days: 7, hours: 1, minutes: 20, seconds: 43 },
  watchers: 8684,
}

/** Leaderboard entries. `flag` is an emoji so there are no asset dependencies. */
export const leaderboard = [
  { flag: '🇵🇸', name: 'Palestine', time: '12:07:45' },
  { flag: '🇹🇭', name: 'Thailand', time: '12:07:49' },
  { flag: '🇺🇬', name: 'Uganda', time: '12:07:50' },
  { flag: '🇧🇷', name: 'Brazil', time: '12:07:52' },
  { flag: '🇰🇪', name: 'Kenya', time: '12:07:56' },
  { flag: '🇯🇵', name: 'Japan', time: '12:08:01' },
  { flag: '🇳🇱', name: 'Netherlands', time: '12:08:04' },
  { flag: '🇿🇦', name: 'South Africa', time: '12:08:09' },
]

export const model = {
  url: '/elong.glb',
  /**
   * The scan is a bust — head down to mid-thigh, no legs or feet — so it is
   * sized at life scale for that span (~60% of a 1.8 m body) rather than 1.8 m.
   * Keeping it honest is what makes the patch sizes in centimetres mean
   * something on screen.
   */
  height: 1.12,
  /** Chest already faces +Z; verified from three render angles. */
  yaw: 0,
  /**
   * Sunk into the dais, so what the dissolve hides is inside the platform —
   * that is what makes the figure read as standing on it rather than through it.
   */
  baseY: -0.12,
  /** Where the dissolve begins, relative to the hem. */
  fadeOffset: 0.06,
  /** Short enough that the fading band clears the dais surface quickly. */
  fadeHeight: 0.12,
  /** Vertical travel of the scanline cut, in metres. */
  fadeBand: 0.05,
  /**
   * The scan ships metalnessFactor/roughnessFactor of 1 driven by its
   * packed ORM texture. These clamps keep skin reading as skin.
   */
  envIntensity: 0.6,
  maxMetalness: 0.5,
  minRoughness: 0.26,
}

export const camera = {
  /** Only the azimuth/elevation of this vector are used; distance is solved. */
  position: [0.7, 0.95, 2.1],
  /** Frames the bust from the dais surface up. */
  target: [0, 0.52, 0],
  fov: 34,
  /**
   * The camera pulls back far enough to fit this box with margin, so the bust
   * never crops on wide, tall or studio-narrowed viewports.
   */
  framing: { height: 1.32, width: 1.05, margin: 1.05 },
  minDistance: 0.55,
  maxDistance: 4.5,
  /** How close a zone focus pulls in, in metres from the zone. */
  focusDistance: 1.75,
}

export const placement = {
  /** Patch width in centimetres at 100%. */
  defaultSizeCm: 9,
  minSizeCm: 3,
  maxSizeCm: 18,
  /** Lifted off the skin so it never z-fights with the scan. */
  surfaceOffset: 0.003,
  /**
   * Fraction of a patch's grid that must land on a co-facing surface. Below
   * this the patch would overhang a silhouette or climb onto a limb.
   */
  minCoverage: 0.82,
}

/** Slow idle rotation of the camera around the figure. */
export const orbit = {
  enabled: true,
  /** Degrees per second. */
  degreesPerSecond: 4.2,
  /** Seconds of stillness after a drag before it picks up again. */
  resumeDelay: 3.5,
}

/**
 * The sponsored positions on the body. There are no other places to put a
 * brand — the studio hands you a patch and you claim one of these.
 *
 * Each `at` is `[x, up]`: x in scene metres from the body's midline, and `up`
 * as a fraction of the bust from the hem (0) to the crown (1). Expressing the
 * height as a fraction keeps the spots on the right anatomy if the figure is
 * ever rescaled or re-seated. Coordinates were chosen by probing the mesh for
 * spots whose surface normal faces the camera.
 */
export const zones = [
  // The figure faces +Z, so its own right side is −X — the side a viewer sees
  // on the left of the screen.
  //
  // `shape` picks the slot geometry: squares for the chest and back, bands
  // (which carry text, not a mark) for the limbs.
  //
  // `tight` marks the spots on a thin limb: a bicep curves away fast, so its
  // marker has to be held to a stricter fit or it wraps off the silhouette.
  { id: 'right-chest', label: 'Right chest', at: [-0.088, 0.66], from: 'front', sizeCm: 8, brandId: 'volt' },
  { id: 'left-chest', label: 'Left chest', at: [0.088, 0.66], from: 'front', sizeCm: 8, brandId: 'higgs' },
  { id: 'abs', label: 'Abs', at: [0, 0.48], from: 'front', sizeCm: 9, brandId: 'apex' },
  { id: 'right-bicep', label: 'Right bicep', at: [-0.185, 0.58], from: 'front', sizeCm: 5, shape: 'band', brandId: 'hypr', tight: true },
  { id: 'left-bicep', label: 'Left bicep', at: [0.195, 0.58], from: 'front', sizeCm: 5, shape: 'band', brandId: 'nova', tight: true },
  { id: 'upper-back', label: 'Upper back', at: [0, 0.64], from: 'back', sizeCm: 10, brandId: 'pulse' },
  { id: 'lower-back', label: 'Lower back', at: [-0.02, 0.35], from: 'back', sizeCm: 10, brandId: 'orbit' },
]
