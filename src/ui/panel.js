import { logoDataUrl } from './patches.js'

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
  const bidRemove = document.querySelector('#js-bidremove')

  /* ------------------------------------------------------- sponsors modal */

  const sponsorsOpen = () => !sponsorsModal.hidden && sponsorsModal.classList.contains('is-open')

  function openSponsors() {
    renderSponsors()
    if (!sponsorsModal.hidden) {
      sponsorsModal.classList.add('is-open')
      return
    }
    sponsorsModal.hidden = false
    // Let the browser paint the dialog before the open transition starts.
    requestAnimationFrame(() => sponsorsModal.classList.add('is-open'))
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
  const renderSponsors = () => {
    const items = [...studio.items.values()]
    sponsorsList.replaceChildren()
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
      logo.src = logoDataUrl(brand, 96)
      logo.alt = open ? '' : `${brand.label} logo`

      const id = document.createElement('span')
      id.className = 'sponsor__id'

      const spot = document.createElement('span')
      spot.className = 'sponsor__spot'
      spot.textContent = item.def.label

      const name = document.createElement('span')
      name.className = 'sponsor__brand'
      if (open) name.classList.add('is-open')
      name.textContent = open ? 'Open spot' : brand.label

      const amount = document.createElement('span')
      amount.className = 'sponsor__amount'
      amount.textContent = open ? 'From $1,000' : brand.amount

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
  }

  /* -------------------------------------------------------------- bid modal */

  let bidBrand = null
  let bidSpotItem = null

  /** Claims the agreed spot outright — every bid is tied to one spot. */
  const confirmBid = (amount) => {
    const brand = bidBrand
    const spot = bidSpotItem
    closeBid()
    if (!brand || !spot) return
    studio.assign(spot.id, brand)
    renderSponsors()
  }

  function openBid(brand, spot = null) {
    bidBrand = brand
    bidSpotItem = spot

    const current = parseCount(brand.amount)
    const spots = spot ? [spot] : [...studio.items.values()].filter((item) => item.brand === brand)

    const open = brand.mark === 'empty'

    bidLogo.src = logoDataUrl(brand, 128)
    bidLogo.alt = open ? '' : `${brand.label} logo`
    bidTitle.textContent = open ? 'This spot is open' : brand.label
    bidHandle.textContent = open ? 'Be the first bid' : brand.handle
    bidCurrent.textContent = open ? '—' : money(current)
    bidTakePrice.textContent = open ? 'From $1,000' : money(current + 1)
    bidSpot.textContent = spot ? `Spotted on the ${spot.def.label.toLowerCase()}` : 'Sponsor a spot'
    bidSpot.hidden = !spot
    bidRemove.hidden = !spot || open

    bidNote.textContent = open
      ? 'No sponsor yet. Take it at the base rate, or name your own price.'
      : spots.length
        ? `Currently on the ${spots.map((entry) => entry.def.label.toLowerCase()).join(' and ')} · ${parseCount(brand.views).toLocaleString('en-US')} views so far.`
        : `${brand.blurb} · ${parseCount(brand.views).toLocaleString('en-US')} views so far.`

    bidAmount.value = ''
    bidAmount.placeholder = money(current + 1).slice(1)
    bidError.hidden = true

    bidModal.hidden = false
    // Let the browser paint the dialog before the open transition starts.
    requestAnimationFrame(() => bidModal.classList.add('is-open'))
    document.body.classList.add('is-modal')
    // Focus the primary action, not the text field — focusing the field pops
    // the keyboard over the button on phones.
    bidTakeBtn.focus({ preventScroll: true })
  }

  function closeBid() {
    if (bidModal.hidden) return
    bidModal.classList.remove('is-open')
    // The sponsors modal shares `is-modal` — keep the page locked while open.
    if (sponsorsModal.hidden) document.body.classList.remove('is-modal')
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
    if (!bidBrand) return
    confirmBid(parseCount(bidBrand.amount) + 1)
  })

  // Keep the field reading as money while it is typed into.
  bidAmount.addEventListener('input', () => {
    const digits = bidAmount.value.replace(/[^0-9]/g, '').slice(0, 9)
    bidAmount.value = digits ? Number(digits).toLocaleString('en-US') : ''
    bidError.hidden = true
  })

  const submitCustom = () => {
    if (!bidBrand) return
    const current = parseCount(bidBrand.amount)
    const entered = Math.floor(Number(bidAmount.value.replace(/[^0-9]/g, '')))

    if (!Number.isFinite(entered) || entered <= 0) {
      bidError.textContent = 'Enter a whole dollar amount.'
      bidError.hidden = false
      bidAmount.focus()
      return
    }
    if (entered <= current) {
      bidError.textContent = `Your bid has to beat the current ${money(current)}.`
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

  bidRemove.addEventListener('click', () => {
    const spot = bidSpotItem
    closeBid()
    if (spot) {
      studio.clearZone(spot.id)
      renderSponsors()
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
  studio.onOpenBid = (brand, item) => openBid(brand, item)

  // Keep the open sponsors list truthful while bids land.
  studio.onChange(() => {
    if (!sponsorsModal.hidden) renderSponsors()
  })

  renderSponsors()

  return { openSponsors, sponsorsOpen }
}
