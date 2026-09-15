import { supabase, isBackendConfigured } from './supabase.js'

/* ------------------------------------------------------------------ toast */

let toastTimer = null

/** Small floating notice for payment states the modals don't cover. */
export function showToast(message, ms = 4200) {
  const toast = document.querySelector('#js-toast')
  if (!toast) return
  toast.textContent = message
  toast.hidden = false
  requestAnimationFrame(() => toast.classList.add('is-visible'))
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible')
    setTimeout(() => {
      toast.hidden = true
    }, 300)
  }, ms)
}

/* -------------------------------------------------------------- validation */

export const MIN_BID_USD = 10
export const MIN_BID_CENTS = MIN_BID_USD * 100

/** Minimum raise over the standing paid bid to take a spot. */
export const BID_INCREMENT_USD = 10
export const BID_INCREMENT_CENTS = BID_INCREMENT_USD * 100

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_LOGO_BYTES = 5 * 1024 * 1024

export const normalizeUrl = (value) => {
  const trimmed = String(value ?? '').trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

export const isValidEmail = (value) => EMAIL_RE.test(String(value ?? '').trim())

export function validateLogoFile(file) {
  if (!file) return 'Add your brand image — it becomes the sticker on the body.'
  if (!file.type.startsWith('image/')) return 'That file is not an image.'
  if (file.size > MAX_LOGO_BYTES) return 'Keep the image under 5 MB.'
  return null
}

/* ------------------------------------------------------------------ supabase */

const requireBackend = () => {
  if (!isBackendConfigured() || !supabase) {
    throw new Error('Bidding is not switched on yet — add the Supabase keys to .env.')
  }
  return supabase
}

/** Uploads the brand logo to public storage, returns its public URL. */
export async function uploadBrandImage(file, bidId) {
  const db = requireBackend()
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png'
  const path = `${bidId || crypto.randomUUID()}.${ext}`
  const { error } = await db.storage.from('brand-logos').upload(path, file, {
    contentType: file.type,
    upsert: false,
  })
  if (error) throw new Error(`Logo upload failed: ${error.message}`)
  return db.storage.from('brand-logos').getPublicUrl(path).data.publicUrl
}

/** Records a pending bid. The edge function re-checks the auction server-side. */
export async function createBid(row) {
  const db = requireBackend()
  const { data, error } = await db.from('bids').insert(row).select().single()
  if (error) throw new Error(`Could not record the bid: ${error.message}`)
  return data
}

/** Highest *paid* bid for a spot, in whole dollars — for the live price line. */
export async function getTopPaidBid(spotId) {
  if (!isBackendConfigured() || !supabase) return null
  const { data, error } = await supabase
    .from('bids')
    .select('amount_cents, brand_name')
    .eq('spot_id', spotId)
    .eq('status', 'paid')
    .order('amount_cents', { ascending: false })
    .limit(1)
  if (error || !data?.length) return null
  return { amount: data[0].amount_cents / 100, brandName: data[0].brand_name }
}

/**
 * Live leaderboard rows (top paid bid per spot, richest first), shaped for
 * the HUD ticker. Null when the backend is off or nothing is paid yet —
 * callers fall back to the static board.
 */
export async function fetchLiveLeaderboard(limit = 8) {
  if (!isBackendConfigured() || !supabase) return null
  const { data, error } = await supabase
    .from('leaderboard')
    .select('spot_label, brand_name, amount_cents')
    .order('amount_cents', { ascending: false })
    .limit(limit)
  if (error || !data?.length) return null
  return data.map((row) => ({
    flag: '★',
    name: `${row.brand_name} · ${row.spot_label} · $${Math.round(row.amount_cents / 100).toLocaleString('en-US')}`,
  }))
}

/** Asks the edge function for a fresh Dodo checkout URL, then leaves for it. */
export async function startCheckout(bidId) {
  const db = requireBackend()
  const returnBase = `${location.origin}${location.pathname}`
  const { data, error } = await db.functions.invoke('create-checkout', {
    body: { bid_id: bidId, return_base: returnBase },
  })
  if (error) throw new Error(`Checkout failed: ${error.message}`)
  if (!data?.checkout_url) throw new Error(data?.error ?? 'Checkout failed: no payment link returned.')
  location.href = data.checkout_url
}

/** Asks the verify-payment edge function to reconcile one bid against Dodo's API. */
export async function verifyBidPayment(bidId) {
  const db = requireBackend()
  try {
    const { data, error } = await db.functions.invoke('verify-payment', {
      body: { bid_id: bidId },
    })
    if (error) return null
    return data?.status ?? null
  } catch {
    return null
  }
}

/** Polls the bid row until the webhook marks it paid/failed, or gives up. */
export async function pollBidStatus(bidId, { intervalMs = 2000, timeoutMs = 60000 } = {}) {
  const db = requireBackend()
  const started = Date.now()
  let verified = false
  for (;;) {
    const { data, error } = await db.from('bids').select('status').eq('id', bidId).single()
    if (!error && data && data.status !== 'pending') return data.status
    const elapsed = Date.now() - started
    // Halfway through the wait, ask Dodo directly — the webhook may be late
    // or misconfigured, and verify-payment can mark the row itself.
    if (!verified && elapsed > Math.min(10000, timeoutMs / 2)) {
      verified = true
      const direct = await verifyBidPayment(bidId)
      if (direct && direct !== 'pending') return direct
    }
    if (elapsed > timeoutMs) break
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  // Final fallback: one last direct check before giving up.
  const direct = await verifyBidPayment(bidId)
  if (direct && direct !== 'pending') return direct
  return 'unknown'
}

/** Loads a remote logo for printing onto the body. */
export function loadBrandImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load the brand image.'))
    image.src = url
  })
}

const storyCache = new Map()

/**
 * A brand site's meta description (Microlink API, cached per URL).
 * Null when unavailable — callers keep their fallback copy.
 */
export async function fetchBrandStory(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim()
  const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  if (!/^https?:\/\/.+\..+/.test(href)) return null
  if (storyCache.has(href)) return storyCache.get(href)
  const pending = (async () => {
    try {
      const res = await fetch(`https://api.microlink.io?url=${encodeURIComponent(href)}`)
      if (!res.ok) return null
      const json = await res.json()
      return String(json?.data?.description ?? '').trim() || null
    } catch {
      return null
    }
  })()
  storyCache.set(href, pending)
  const story = await pending
  storyCache.set(href, story)
  return story
}

/* ---------------------------------------------------------- payment return */

/** Top paid bid per spot, richest first — the source of truth for the body. */
export async function fetchPaidBids() {
  if (!isBackendConfigured() || !supabase) return []
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('status', 'paid')
    .order('amount_cents', { ascending: false })
  if (error || !data?.length) return []
  const seen = new Set()
  return data.filter((bid) => {
    if (seen.has(bid.spot_id)) return false
    seen.add(bid.spot_id)
    return true
  })
}

/** Prints one paid bid onto its spot. False when the spot is missing/unprintable. */
export async function paintPaidBid(studio, bid) {
  const item = studio.items.get(bid.spot_id)
  if (!item) return false
  try {
    const image = await loadBrandImage(bid.brand_image_url)
    studio.assign(bid.spot_id, {
      id: `bid-${bid.id}`,
      label: bid.brand_name,
      style: 'logo',
      color: '#f2f5f7',
      seed: 7,
      monogram: '★',
      handle: '@you',
      blurb: bid.product_url,
      url: String(bid.product_url ?? '').replace(/^https?:\/\//, ''),
      amount: `$${Number(bid.amount_cents / 100).toLocaleString('en-US')}`,
      views: '0',
      image,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Prints every top paid bid onto the body — so all visitors see sold spots,
 * not just the buyer on return. Safe to call on every boot after setAvatar.
 */
export async function paintAllPaidBids(studio) {
  const bids = await fetchPaidBids()
  for (const bid of bids) {
    await paintPaidBid(studio, bid)
  }
  return bids
}

/**
 * Runs once at boot after the spots exist. When Dodo redirects back with
 * `?bid=<id>` (Dodo also appends its own `payment_id`/`status` params),
 * waits for the webhook — with a direct verify-payment fallback — and, if
 * this bid is still the top paid bid for its spot, prints the buyer's logo
 * on the body. Returns the paid bid row, or null when nothing to settle.
 */
export async function settlePaymentReturn(studio) {
  const params = new URLSearchParams(location.search)
  const bidId = params.get('bid')
  if (!bidId) return null
  // Take the params out of the address bar so a reload doesn't re-settle.
  history.replaceState(null, '', location.pathname)

  if (!isBackendConfigured() || !supabase) {
    showToast('Payment link opened, but bidding is not switched on in this build.')
    return null
  }

  showToast('Confirming your payment…')
  const status = await pollBidStatus(bidId)

  if (status !== 'paid') {
    showToast(
      status === 'failed' || status === 'cancelled'
        ? 'That payment did not go through — no charge was made.'
        : 'Payment is still confirming — the spot updates automatically once it lands.',
    )
    return null
  }

  const { data: bid, error } = await supabase.from('bids').select('*').eq('id', bidId).single()
  if (error || !bid) return null

  // Auction guard: a higher paid bid may have landed while paying.
  const { data: higher } = await supabase
    .from('bids')
    .select('id')
    .eq('spot_id', bid.spot_id)
    .eq('status', 'paid')
    .gt('amount_cents', bid.amount_cents)
    .limit(1)
  if (higher?.length) {
    showToast('Paid, but a higher bid beat you to this spot — contact us for a refund.')
    return null
  }

  const painted = await paintPaidBid(studio, bid)
  if (!painted) {
    showToast('Paid, but the logo could not be printed — contact us.')
    return null
  }

  return bid
}

/* ------------------------------------------------------------------ catalog */

/**
 * Brand catalogue from the database, shaped exactly like the baked-in rows
 * (display strings for amount/views) so the renderer needs no changes.
 * Null when the backend is off — callers keep the baked-in catalogue.
 */
export async function fetchBrands() {
  if (!isBackendConfigured() || !supabase) return null
  const { data, error } = await supabase
    .from('brands')
    .select('id, label, mark, fill, seed, band, handle, blurb, url, amount_cents, views, logo_url, contact_email')
    .order('label')
  if (error || !data?.length) return null
  return data.map((row) => ({
    id: row.id,
    label: row.label,
    mark: row.mark,
    fill: row.fill,
    seed: row.seed,
    band: row.band ?? [],
    handle: row.handle,
    blurb: row.blurb,
    url: row.url,
    amount: `$${Math.round(row.amount_cents / 100).toLocaleString('en-US')}`,
    views: Number(row.views).toLocaleString('en-US'),
    logoUrl: row.logo_url || null,
    contactEmail: row.contact_email || null,
  }))
}

/** Ticker countries from the database. Null → callers keep the static list. */
export async function fetchTickerCountries() {
  if (!isBackendConfigured() || !supabase) return null
  const { data, error } = await supabase
    .from('ticker_countries')
    .select('flag, name')
    .order('position')
  if (error || !data?.length) return null
  return data
}

/* ------------------------------------------------------------ spot clicks */

/**
 * Records one tap on a placed brand. Fire-and-forget — a counter must never
 * break the bid dialog. No-ops without the backend.
 */
export function recordSpotClick(spotId) {
  if (!isBackendConfigured() || !supabase) return
  supabase.rpc('record_spot_click', { p_spot_id: spotId }).then(
    () => {},
    () => {},
  )
}

/** Total clicks per spot across all visitors. Empty map when unavailable. */
export async function fetchSpotClicks() {
  const counts = new Map()
  if (!isBackendConfigured() || !supabase) return counts
  const { data, error } = await supabase.from('spot_clicks').select('spot_id, clicks')
  if (error || !data) return counts
  for (const row of data) counts.set(row.spot_id, Number(row.clicks) || 0)
  return counts
}

const LOCAL_CLICKS_KEY = 'smb-spot-clicks'

/** This visitor's own per-spot taps, kept in localStorage. */
export function getLocalSpotClicks() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CLICKS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

/** Bumps this visitor's tap count for a spot. Returns the new total. */
export function bumpLocalSpotClick(spotId) {
  const counts = getLocalSpotClicks()
  counts[spotId] = (Number(counts[spotId]) || 0) + 1
  try {
    localStorage.setItem(LOCAL_CLICKS_KEY, JSON.stringify(counts))
  } catch {
    // Private mode etc. — the global counter still records the tap.
  }
  return counts[spotId]
}
