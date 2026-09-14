import { logoDataUrl, patchAspect } from './patches.js'
import { initClickSounds, playClick } from '../lib/sound.js'
import {
  BID_INCREMENT_USD,
  MIN_BID_USD,
  bumpLocalSpotClick,
  createBid,
  fetchSpotClicks,
  getLocalSpotClicks,
  getTopPaidBid,
  isValidEmail,
  normalizeUrl,
  recordSpotClick,
  startCheckout,
  uploadBrandImage,
  validateLogoFile,
} from '../lib/bidding.js'

/** View counts are written as copy ("32,269"), so tolerate the punctuation. */
const parseCount = (value) => {
  const digits = String(value).replace(/[^0-9]/g, '')
  return digits ? Number(digits) : 0
}

/**
 * Wires the two dialogs:
 *
 *  - the sponsors list, the only place every spot on the body can be seen at
 *    once — opened exclusively by the View sponsors button, and
 *  - the bid dialog, opened by tapping a placeholder or a brand on the body
 *    (or a row in the sponsors list) to claim that one spot.
 *
 * All placement state lives in BrandSlots; this file only reads and reports it.
 */
export function initSponsors({ studio }) {
  initClickSounds()
  const money = (value) => `$${Math.round(value).toLocaleString('en-US')}`

  // Sponsors modal.
  const sponsorsModal = document.querySelector('#js-sponsorsmodal')
  const sponsorsScrim = document.querySelector('#js-sponsorsscrim')
  const sponsorsClose = document.querySelector('#js-sponsorsclose')
  const sponsorsList = document.querySelector('#js-sponsorslist')
  const sponsorsEmpty = document.querySelector('#js-sponsorsempty')
  const sponsorsSub = document.querySelector('#js-sponsorssub')

  // Bid modal.
  const bidModal = document.querySelector('#js-bidmodal')
  const bidScrim = document.querySelector('#js-bidscrim')
  const bidClose = document.querySelector('#js-bidclose')
  const bidLogo = document.querySelector('#bid-logo')
  const bidTitle = document.querySelector('#bid-title')
  const bidHandle = document.querySelector('#bid-handle')
  const bidCurrent = document.querySelector('#bid-current')
  const bidNote = document.querySelector('#bid-note')
  const bidTakeBtn = document.querySelector('#js-bidtake')
  const bidTakePrice = document.querySelector('#bid-take')
  const bidAmount = document.querySelector('#js-bidamount')
  const bidSubmit = document.querySelector('#js-bidsubmit')
  const bidError = document.querySelector('#js-biderror')
  const bidSpot = document.querySelector('#bid-spot')
  const bidHint = document.querySelector('#js-bidhint')
  const bidMinPill = document.querySelector('#js-bidmin')
  const bidClicks = document.querySelector('#js-bidclicks')

  // Details-first view for claimed spots: brand info + take-space CTA.
  // The bid form stays hidden until the CTA is pressed.
  const bidDetails = document.querySelector('#js-biddetails')
  const bidBlurb = document.querySelector('#js-bidblurb')
  const bidLink = document.querySelector('#js-bidlink')
  const takeSpaceBtn = document.querySelector('#js-takespace')
  const takeSpacePrice = document.querySelector('#js-takespace-price')
  const takeSpaceHint = document.querySelector('#js-takespace-hint')
  const bidFormBrand = document.querySelector('#js-bidform-brand')
  const bidFormAmount = document.querySelector('#js-bidform-amount')

  // Buyer details.
  const bidName = document.querySelector('#js-bidname')
  const bidEmail = document.querySelector('#js-bidemail')
  const bidUrl = document.querySelector('#js-bidurl')
  const bidImage = document.querySelector('#js-bidimage')
  const bidPreview = document.querySelector('#js-bidpreview')
  const bidFileTitle = document.querySelector('#js-bidfiletitle')
  const bidFit = document.querySelector('#js-bidfit')
  const bidSize = document.querySelector('#js-bidsize')
  const bidDetailsError = document.querySelector('#js-bidderror')

  /* ------------------------------------------------------- sponsors modal */

  const sponsorsOpen = () => !sponsorsModal.hidden && sponsorsModal.classList.contains('is-open')

  /**
   * Unhides a dialog and starts its enter transition synchronously. The old
   * double-rAF waited two frames while the card sat at opacity 0 — on a phone
   * GPU in the middle of the camera fly-to those frames arrive late and the
   * tap feels dead. A forced reflow separates the unhidden style from the
   * transition start without waiting on the frame clock.
   */
  const showModal = (modal) => {
    modal.hidden = false
    void modal.offsetHeight
    modal.classList.add('is-open')
  }

  function openSponsors() {
    renderSponsors()
    if (!sponsorsModal.hidden) {
      sponsorsModal.classList.add('is-open')
      return
    }
    showModal(sponsorsModal)
    document.body.classList.add('is-modal')
    sponsorsClose.focus({ preventScroll: true })
  }

  function closeSponsors() {
    if (sponsorsModal.hidden) return
    sponsorsModal.classList.remove('is-open')
    // The bid modal shares `is-modal` — only release the page scroll lock
    // when no dialog remains visible.
    if (bidModal.hidden) document.body.classList.remove('is-modal')

    const done = () => {
      if (sponsorsModal.classList.contains('is-open')) return
      sponsorsModal.hidden = true
      sponsorsModal.removeEventListener('transitionend', done)
    }
    sponsorsModal.addEventListener('transitionend', done)
    // Fallback for reduced-motion, where no transition fires.
    setTimeout(done, 400)
  }

  sponsorsClose.addEventListener('click', closeSponsors)
  sponsorsScrim.addEventListener('click', closeSponsors)

  /** One row per spot on the body: logo, spot name, brand and price. */
  let pendingLogos = []
  let logoFillQueued = false

  // Logo PNG encodes run after first paint so the dialog opens instantly;
  // the cache makes repeat opens free either way.
  const scheduleLogoFill = () => {
    if (logoFillQueued) return
    logoFillQueued = true
    const fill = () => {
      logoFillQueued = false
      for (const [img, brand] of pendingLogos.splice(0)) {
        if (img.isConnected) img.src = logoDataUrl(brand, 96)
      }
    }
    if ('requestIdleCallback' in window) requestIdleCallback(fill, { timeout: 400 })
    else requestAnimationFrame(() => requestAnimationFrame(fill))
  }

  const sponsorsSig = () => [...studio.items.values()].map((item) => `${item.id}:${item.brand.id}`).join('|')
  let lastSponsorsSig = ''

  const renderSponsors = () => {
    const items = [...studio.items.values()]
    lastSponsorsSig = sponsorsSig()
    sponsorsList.replaceChildren()
    pendingLogos = []
    sponsorsEmpty.hidden = items.length > 0
    sponsorsSub.textContent =
      items.length > 0 ? `${items.length} spots on the body.` : 'Every spot on the body.'

    for (const item of items) {
      const brand = item.brand
      const open = brand.mark === 'empty'

      const row = document.createElement('li')

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'sponsor'

      const logo = document.createElement('img')
      logo.className = 'sponsor__logo'
      logo.alt = open ? '' : `${brand.label} logo`
      logo.decoding = 'async'
      // src fills in after paint (see scheduleLogoFill) — fixed CSS size,
      // so rows never shift when the artwork lands.
      pendingLogos.push([logo, brand])

      const id = document.createElement('span')
      id.className = 'sponsor__id'

      const spot = document.createElement('span')
      spot.className = 'sponsor__spot'
      spot.textContent = item.def.label
      spot.dataset.spotId = item.id
      spot.dataset.base = item.def.label

      const name = document.createElement('span')
      name.className = 'sponsor__brand'
      if (open) name.classList.add('is-open')
      name.textContent = open ? 'Open spot' : brand.label

      const amount = document.createElement('span')
      amount.className = 'sponsor__amount'
      amount.textContent = open ? `From $${item.def.minBid ?? MIN_BID_USD}` : brand.amount

      id.append(spot, name)
      button.append(logo, id, amount)
      button.addEventListener('click', () => {
        closeSponsors()
        studio.focus(item.id)
        openBid(brand, item)
      })

      row.append(button)
      sponsorsList.append(row)
    }
    scheduleLogoFill()
    refreshSponsorClicks()
  }

  // Fills per-spot tap counts into the open list (global totals, falling
  // back to this visitor's own counts when the backend is off).
  const refreshSponsorClicks = async () => {
    let totals
    try {
      totals = await fetchSpotClicks()
    } catch {
      totals = new Map()
    }
    const local = getLocalSpotClicks()
    for (const el of sponsorsList.querySelectorAll('[data-spot-id]')) {
      if (!el.isConnected) continue
      const n = totals.get(el.dataset.spotId) ?? Number(local[el.dataset.spotId]) ?? 0
      el.textContent = n > 0 ? `${el.dataset.base} · ${n.toLocaleString('en-US')} clicks` : el.dataset.base
    }
  }

  /* -------------------------------------------------------------- bid modal */

  let bidBrand = null
  let bidSpotItem = null
  let bidFloor = MIN_BID_USD
  let bidBusy = false
  let previewUrl = null

  // Temporary body preview: the uploaded logo is painted onto the focused
  // spot while the bid dialog is open, then restored on close (the spot only
  // changes for real once payment succeeds).
  let previewSpotId = null
  let previewOriginalBrand = null

  const clearBodyPreview = () => {
    if (previewSpotId && previewOriginalBrand) {
      const item = studio.items.get(previewSpotId)
      // Only restore when our preview is still the live artwork — a paid
      // paint landing meanwhile must never be clobbered.
      if (item && item.brand?.id === `preview-${previewSpotId}`) {
        studio.assign(previewSpotId, previewOriginalBrand)
      }
    }
    previewSpotId = null
    previewOriginalBrand = null
  }

  /** Paints an already-loaded image onto the focused spot as a preview. */
  const paintBodyPreview = (spot, image) => {
    const item = studio.items.get(spot.id)
    if (!item) return
    if (previewSpotId !== spot.id) {
      clearBodyPreview()
      previewSpotId = spot.id
      previewOriginalBrand = item.brand
    }
    studio.assign(spot.id, {
      id: `preview-${spot.id}`,
      label: bidName.value.trim() || item.brand?.label || 'Your logo',
      mark: 'preview',
      fill: '#edf2f5',
      seed: item.brand?.seed ?? 7,
      handle: '@you',
      blurb: '',
      url: '',
      amount: item.brand?.amount ?? '',
      views: item.brand?.views ?? '0',
      logoUrl: previewUrl,
      image,
    })
  }

  const SHAPE_WORDS = { square: 'square print', band: 'strap', wide: 'wide banner' }

  /** Tap counter line in the bid dialog: global total plus your own taps. */
  const paintBidClicks = (spot, total) => {
    const mine = Number(getLocalSpotClicks()[spot.id]) || 0
    const parts = []
    if (total > 0) parts.push(`${total.toLocaleString('en-US')} click${total === 1 ? '' : 's'} on this spot`)
    if (mine > 0) parts.push(`${mine} by you`)
    if (!parts.length) {
      bidClicks.hidden = true
      return
    }
    bidClicks.textContent = `👆 ${parts.join(' · ')}`
    bidClicks.hidden = false
  }

  const renderBidClicks = (spot, brand) => {
    if (!spot || brand.mark === 'empty') {
      bidClicks.hidden = true
      return
    }
    paintBidClicks(spot, 0)
    fetchSpotClicks()
      .then((totals) => {
        if (bidSpotItem !== spot || bidModal.hidden) return
        paintBidClicks(spot, totals.get(spot.id) ?? 0)
      })
      .catch(() => {})
  }

  /** Sticker-size suggestion so the buyer's logo fits the spot it lands on. */
  const renderSizeHint = (spot) => {
    if (!spot) {
      bidSize.hidden = true
      return
    }
    const size = Math.round(spot.sizeCm ?? 12)
    const shape = SHAPE_WORDS[spot.shape] ?? 'print'
    bidSize.textContent =
      `Best on the ${spot.def.label.toLowerCase()}: ≈${size} cm ${shape} — ` +
      `a clean, squarish logo file fills it best.`
    bidSize.hidden = false
  }

  /** Fit note once a logo file is picked, against the spot's proportions. */
  const renderFitNote = (file) => {
    if (!file || !bidSpotItem) {
      bidFit.textContent = 'PNG or JPG · printed as the sticker'
      return
    }
    const url = URL.createObjectURL(file)
    const probe = new Image()
    probe.onload = () => {
      URL.revokeObjectURL(url)
      // Stale pick (dialog reopened or another file chosen meanwhile).
      if (bidImage.files?.[0] !== file) return
      const ratio = probe.naturalWidth / probe.naturalHeight / patchAspect(bidSpotItem.shape)
      bidFit.textContent =
        ratio > 1.5
          ? 'Wide file — it will shrink to fit the sticker height.'
          : ratio < 1 / 1.5
            ? 'Tall file — it will shrink to fit the sticker width.'
            : 'Good proportions — fills the sticker nicely.'
    }
    probe.onerror = () => URL.revokeObjectURL(url)
    probe.src = url
  }

  const readDetails = () => {
    const name = bidName.value.trim()
    const email = bidEmail.value.trim()
    const productUrl = normalizeUrl(bidUrl.value)
    const file = bidImage.files?.[0] ?? null
    if (name.length < 2) return { error: 'Give your brand a name (2+ characters).' }
    if (!isValidEmail(email)) return { error: 'Enter a valid email for the receipt.' }
    if (!/^https?:\/\/.+\..+/.test(productUrl)) {
      return { error: 'Enter a valid product URL, e.g. https://yourbrand.com.' }
    }
    const fileError = validateLogoFile(file)
    if (fileError) return { error: fileError }
    return { name, email, productUrl, file }
  }

  const setBidBusy = (busy, amount) => {
    bidBusy = busy
    bidTakeBtn.disabled = busy
    bidSubmit.disabled = busy
    bidTakeBtn.querySelector('.bidtake__label').textContent = busy ? 'Processing…' : 'Continue to payment'
    if (!busy && amount !== undefined) bidTakePrice.textContent = money(amount)
  }

  /**
   * Records the bid, then hands off to Dodo checkout. The spot is only
   * claimed once the webhook confirms payment (see settlePaymentReturn).
   */
  const confirmBid = async (amount) => {
    if (bidBusy) return
    const brand = bidBrand
    const spot = bidSpotItem
    if (!brand || !spot) return

    const details = readDetails()
    if (details.error) {
      bidDetailsError.textContent = details.error
      bidDetailsError.hidden = false
      return
    }
    bidDetailsError.hidden = true

    setBidBusy(true)
    try {
      const imageUrl = await uploadBrandImage(details.file, crypto.randomUUID())
      const bid = await createBid({
        spot_id: spot.id,
        spot_label: spot.def.label,
        amount_cents: Math.round(amount * 100),
        brand_name: details.name,
        email: details.email,
        product_url: details.productUrl,
        brand_image_url: imageUrl,
        suggested_size_cm: Math.round(spot.sizeCm ?? 12),
      })
      await startCheckout(bid.id)
      // A successful checkout leaves this page for Dodo — no UI to restore.
    } catch (err) {
      bidDetailsError.textContent = err instanceof Error ? err.message : 'Something went wrong.'
      bidDetailsError.hidden = false
      setBidBusy(false, amount)
    }
  }

  function openBid(brand, spot = null) {
    clearBodyPreview()
    bidBrand = brand
    bidSpotItem = spot
    bidBusy = false

    const current = parseCount(brand.amount)
    const open = brand.mark === 'empty'
    // Starting bid: the spot's own floor when open, current + $10 above that.
    const startBid = open ? (spot?.def?.minBid ?? MIN_BID_USD) : current + BID_INCREMENT_USD
    bidFloor = startBid
    const spots = spot ? [spot] : [...studio.items.values()].filter((item) => item.brand === brand)

    // Claimed spots land on the details view first — the form (CTA target)
    // stays hidden until "Take this space" is pressed. Open spots skip
    // straight to the form.
    const showDetails = !open
    if (showDetails) {
      bidFormBrand.hidden = true
      bidFormAmount.hidden = true
      bidDetails.hidden = false

      const blurb = String(brand.blurb ?? '').trim()
      if (blurb) {
        bidBlurb.textContent = blurb
        bidBlurb.hidden = false
      } else {
        bidBlurb.hidden = true
      }
      const rawUrl = String(brand.url ?? '').trim()
      if (rawUrl) {
        const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
        const label = rawUrl.replace(/^https?:\/\//i, '').replace(/\/$/, '')
        bidLink.href = href
        bidLink.textContent = `${label} ↗`
        bidLink.hidden = false
      } else {
        bidLink.hidden = true
      }
      takeSpacePrice.textContent = money(startBid)
      takeSpaceHint.textContent =
        `Take it for ${money(startBid)} — outbids ${money(current)} by $${BID_INCREMENT_USD}. ` +
        `You pay securely — the spot updates once payment succeeds.`
    } else {
      bidDetails.hidden = true
      bidFormBrand.hidden = false
      bidFormAmount.hidden = false
    }

    // Heavy part: drawing a multi-megapixel upload into the tile blocks first
    // paint on phones, so it lands after the dialog is visible (and is cached
    // after the first open, like the sponsors rows).
    if (brand.image?.naturalWidth > 0) {
      bidLogo.removeAttribute('src')
      requestAnimationFrame(() => {
        if (bidBrand === brand && !bidModal.hidden) bidLogo.src = logoDataUrl(brand, 128)
      })
    } else {
      bidLogo.src = logoDataUrl(brand, 128)
    }
    bidLogo.alt = open ? '' : `${brand.label} logo`
    bidTitle.textContent = open ? 'This spot is open' : brand.label
    bidHandle.textContent = open ? 'Be the first bid' : brand.handle
    bidCurrent.textContent = open ? `From $${startBid}` : money(current)
    bidTakePrice.textContent = money(startBid)
    bidMinPill.textContent = `Min ${money(startBid)}`
    bidSpot.textContent = spot ? `Spotted on the ${spot.def.label.toLowerCase()}` : 'Sponsor a spot'
    bidSpot.hidden = !spot
    bidHint.textContent = open
      ? `Minimum bid is $${startBid}. You pay securely — the spot updates once payment succeeds.`
      : `Outbids the standing price by $${BID_INCREMENT_USD}. You pay securely — the spot updates once payment succeeds.`

    const viewCount = parseCount(brand.views)
    const viewsSuffix = viewCount > 0 ? ` · ${viewCount.toLocaleString('en-US')} views so far.` : ''
    bidNote.textContent = open
      ? `No sponsor yet. Take it from $${startBid}, or name your own price.`
      : spots.length
        ? `Currently on the ${spots.map((entry) => entry.def.label.toLowerCase()).join(' and ')}${viewsSuffix}`
        : `${brand.blurb}${viewsSuffix}`

    bidAmount.value = ''
    bidAmount.placeholder = money(startBid).slice(1)
    bidError.hidden = true

    // Buyer details start fresh; default the name to the standing brand.
    bidName.value = open ? '' : brand.label
    bidEmail.value = ''
    bidUrl.value = ''
    bidImage.value = ''
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      previewUrl = null
    }
    bidPreview.src = ''
    bidPreview.hidden = true
    bidFileTitle.textContent = 'Upload brand image'
    bidDetailsError.hidden = true
    setBidBusy(false, startBid)
    renderSizeHint(spot)
    renderBidClicks(spot, brand)
    renderFitNote(null)

    showModal(bidModal)
    document.body.classList.add('is-modal')
    // Details-first for claimed spots: focus the take-space CTA. Open spots
    // go straight to the form — focus the payment action, not the text
    // field, so the keyboard never covers the button on phones.
    if (showDetails) takeSpaceBtn.focus({ preventScroll: true })
    else bidTakeBtn.focus({ preventScroll: true })

    // Paid bids on Supabase outrank the catalogue price — refresh the line
    // without disturbing a dialog that has since moved on.
    if (spot && !open) {
      getTopPaidBid(spot.id)
        .then((top) => {
          if (!top || bidSpotItem !== spot || bidModal.hidden) return
          const live = Math.max(current, Math.floor(top.amount))
          if (live === current) return
          bidFloor = live + BID_INCREMENT_USD
          bidCurrent.textContent = money(live)
          if (!bidBusy) bidTakePrice.textContent = money(live + BID_INCREMENT_USD)
          bidAmount.placeholder = money(live + BID_INCREMENT_USD).slice(1)
          takeSpacePrice.textContent = money(live + BID_INCREMENT_USD)
          takeSpaceHint.textContent =
            `Take it for ${money(live + BID_INCREMENT_USD)} — outbids ${money(live)} by $${BID_INCREMENT_USD}. ` +
            `You pay securely — the spot updates once payment succeeds.`
        })
        .catch(() => {})
    }
  }

  // Details → form: the CTA reveals the buyer + bid form for this spot.
  takeSpaceBtn.addEventListener('click', () => {
    if (!bidBrand || !bidSpotItem) return
    bidDetails.hidden = true
    bidFormBrand.hidden = false
    bidFormAmount.hidden = false
    bidTakeBtn.focus({ preventScroll: true })
  })

  function closeBid() {
    if (bidModal.hidden) return
    bidModal.classList.remove('is-open')
    // The sponsors modal shares `is-modal` — keep the page locked while open.
    if (sponsorsModal.hidden) document.body.classList.remove('is-modal')
    // Drop the temporary logo from the body before forgetting the spot.
    clearBodyPreview()
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      previewUrl = null
    }
    bidBrand = null
    bidSpotItem = null
    // Unfocus the spot so the camera flies back out to the full figure.
    studio.focus(null)

    const done = () => {
      bidModal.hidden = true
      bidModal.removeEventListener('transitionend', done)
    }
    bidModal.addEventListener('transitionend', done)
    // Fallback for reduced-motion, where no transition fires.
    setTimeout(done, 400)
  }

  bidTakeBtn.addEventListener('click', () => {
    if (!bidBrand || bidBusy) return
    confirmBid(bidFloor)
  })

  // Keep the field reading as money while it is typed into.
  bidAmount.addEventListener('input', () => {
    const digits = bidAmount.value.replace(/[^0-9]/g, '').slice(0, 9)
    bidAmount.value = digits ? Number(digits).toLocaleString('en-US') : ''
    bidError.hidden = true
  })

  const submitCustom = () => {
    if (!bidBrand || bidBusy) return
    const entered = Math.floor(Number(bidAmount.value.replace(/[^0-9]/g, '')))

    if (!Number.isFinite(entered) || entered <= 0) {
      bidError.textContent = 'Enter a whole dollar amount.'
      bidError.hidden = false
      bidAmount.focus()
      return
    }
    if (entered < bidFloor) {
      bidError.textContent =
        bidBrand.mark === 'empty'
          ? `Minimum bid is $${bidFloor}.`
          : `Your bid has to beat the current ${money(bidFloor - BID_INCREMENT_USD)} by $${BID_INCREMENT_USD}.`
      bidError.hidden = false
      bidAmount.focus()
      return
    }

    confirmBid(entered)
  }

  bidSubmit.addEventListener('click', submitCustom)
  bidAmount.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      submitCustom()
    }
  })

  // Brand image picker: instant preview plus a fit note for this spot.
  // The logo is also painted onto the body immediately as a temporary
  // preview — removed again when the dialog closes without payment.
  bidImage.addEventListener('change', () => {
    const file = bidImage.files?.[0] ?? null
    const spot = bidSpotItem
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      previewUrl = null
    }
    bidDetailsError.hidden = true
    if (!file) {
      bidPreview.src = ''
      bidPreview.hidden = true
      bidFileTitle.textContent = 'Upload brand image'
      renderFitNote(null)
      clearBodyPreview()
      return
    }
    const fileError = validateLogoFile(file)
    if (fileError) {
      bidDetailsError.textContent = fileError
      bidDetailsError.hidden = false
      bidImage.value = ''
      clearBodyPreview()
      return
    }
    previewUrl = URL.createObjectURL(file)
    bidPreview.src = previewUrl
    bidPreview.hidden = false
    bidFileTitle.textContent = file.name
    renderFitNote(file)

    if (spot && studio.items.has(spot.id)) {
      // Separate object URL for the texture so revoking previewUrl (modal
      // thumbnail) can never break the in-flight body paint, and vice versa.
      const bodyUrl = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        URL.revokeObjectURL(bodyUrl)
        // Stale pick (dialog moved on or another file chosen meanwhile).
        if (bidImage.files?.[0] !== file || bidSpotItem !== spot || bidModal.hidden) return
        paintBodyPreview(spot, image)
      }
      image.onerror = () => URL.revokeObjectURL(bodyUrl)
      image.src = bodyUrl
    }
  })

  bidClose.addEventListener('click', closeBid)
  bidScrim.addEventListener('click', closeBid)
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    // The bid modal sits above the sponsors list — let its Escape win first.
    if (!bidModal.hidden) closeBid()
    else if (!sponsorsModal.hidden) closeSponsors()
  })

  /* ------------------------------------------------------------------ wiring */

  // A tap on a placeholder or a brand on the body opens the bid dialog for
  // that spot directly. The sponsors list never opens from the body.
  studio.onOpenBid = (brand, item) => {
    playClick()
    openBid(brand, item)
  }

  // Taps on placed brands count — locally per visitor, globally per spot.
  studio.onSpotClick = (item) => {
    bumpLocalSpotClick(item.id)
    recordSpotClick(item.id)
  }

  // Rebuild the open list only when its contents change — hover/focus
  // changes emit too, and a full rebuild per pointer move is pure jank.
  studio.onChange(() => {
    if (sponsorsModal.hidden || sponsorsSig() === lastSponsorsSig) return
    renderSponsors()
  })

  renderSponsors()

  return { openSponsors, sponsorsOpen }
}
