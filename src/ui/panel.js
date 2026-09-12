import { BRANDS, createPatchCanvas, logoDataUrl } from './patches.js'
import { placement as config } from '../config.js'

const cm = (value) => `${value} cm`
/** View counts are written as copy ("32,269"), so tolerate the punctuation. */
const parseCount = (value) => {
  const digits = String(value).replace(/[^0-9]/g, '')
  return digits ? Number(digits) : 0
}

/**
 * Wires the right-hand panel. It has two modes:
 *
 *  - the studio, where you pick a brand and claim one of the eight spots, and
 *  - the sponsor card, which takes over the panel when a spot is opened.
 *
 * All placement state lives in BodyZones; this file only reads and reports it.
 */
export function initStudio({ studio, onOpenChange }) {
  const panel = document.querySelector('#studio')
  const tab = document.querySelector('#js-studiotab')
  const close = document.querySelector('#js-studioclose')
  const zonesGrid = document.querySelector('#js-zones')
  const brandsGrid = document.querySelector('#js-brands')
  const empty = document.querySelector('#js-empty')
  const count = document.querySelector('#js-count')
  const hint = document.querySelector('#js-hint')
  const dropzone = document.querySelector('#js-dropzone')
  const fileInput = document.querySelector('#js-logo')

  const sizeInput = document.querySelector('#js-size')
  const sizeOut = document.querySelector('#js-size-out')
  const rotInput = document.querySelector('#js-rot')
  const rotOut = document.querySelector('#js-rot-out')
  const opacityInput = document.querySelector('#js-opacity')
  const opacityOut = document.querySelector('#js-opacity-out')

  // Sponsor card.
  const cardClose = document.querySelector('#bc-close')
  const cardTitle = document.querySelector('#bc-title')
  const cardViews = document.querySelector('#bc-views')
  const cardLogo = document.querySelector('#bc-logo')
  const cardBrand = document.querySelector('#bc-brand')
  const cardHandle = document.querySelector('#bc-handle')
  const cardBlurb = document.querySelector('#bc-blurb')
  const cardLink = document.querySelector('#bc-link')
  const cardAmount = document.querySelector('#bc-amount')

  let customCount = 0
  let zoneChips = new Map()

  /* ------------------------------------------------------------- open/close */

  const setOpen = (open) => {
    document.body.classList.toggle('has-studio', open)
    tab.setAttribute('aria-expanded', String(open))
    onOpenChange?.(open)
  }

  tab.addEventListener('click', () => setOpen(true))
  close.addEventListener('click', () => setOpen(false))
  cardClose.addEventListener('click', () => studio.focus(null))

  /* ----------------------------------------------------------- zone chips -- */

  /** Compact colour chip per sponsor spot. Clicking one opens that spot. */
  const buildZoneChips = (items) => {
    zonesGrid.replaceChildren()
    zoneChips = new Map()

    for (const item of items) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'zonechip'
      chip.dataset.zoneId = item.id

      const swatch = document.createElement('i')
      swatch.className = 'zonechip__swatch'

      const label = document.createElement('span')
      label.className = 'zonechip__label'
      label.textContent = item.def.label

      chip.append(swatch, label)
      chip.addEventListener('click', () => studio.focus(item.id))
      chip.addEventListener('mouseenter', () => {
        studio.hoveredId = item.id
        studio._applyHighlight()
      })
      chip.addEventListener('mouseleave', () => {
        studio.hoveredId = null
        studio._applyHighlight()
      })

      zonesGrid.append(chip)
      zoneChips.set(item.id, { chip, swatch, label })
    }
  }

  const renderZones = ({ items, hoveredId, focusedId }) => {
    if (zoneChips.size !== items.length) buildZoneChips(items)
    count.textContent = String(items.length)
    empty.hidden = items.length > 0

    for (const item of items) {
      const entry = zoneChips.get(item.id)
      if (!entry) continue
      entry.swatch.style.background = item.brand.color
      entry.chip.classList.toggle('is-focused', item.id === focusedId)
      entry.chip.classList.toggle('is-hovered', item.id === hoveredId)
      entry.chip.title = `${item.def.label} — ${item.brand.label}`
    }
  }

  /* ------------------------------------------------------------ brand grid */

  const buildBrands = () => {
    for (const brand of BRANDS) {
      const card_ = document.createElement('button')
      card_.type = 'button'
      card_.className = 'patchcard'
      card_.dataset.brandId = brand.id

      const swatch = createPatchCanvas(brand, { size: 168 })
      swatch.style.width = '100%'
      swatch.style.height = 'auto'
      card_.append(swatch)

      const label = document.createElement('span')
      label.textContent = brand.label
      card_.append(label)

      card_.addEventListener('click', () => {
        const arming = studio.armed?.id !== brand.id
        studio.setArmed(arming ? brand : null)
      })

      brandsGrid.append(card_)
    }
  }

  /* ----------------------------------------------------------------- upload */

  const readImage = (file) =>
    new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        reject(new Error('Not an image'))
        return
      }
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('Could not read that file'))
      image.src = url
    })

  const handleFiles = async (files) => {
    const file = files?.[0]
    if (!file) return

    try {
      const image = await readImage(file)
      customCount += 1

      const brand = {
        id: `custom-${customCount}`,
        label: file.name.replace(/\.[^.]+$/, '').slice(0, 14) || 'Your brand',
        style: 'logo',
        color: '#f2f5f7',
        seed: 100 + customCount,
        monogram: '★',
        handle: '@yourbrand',
        blurb: 'Uploaded logo, held in this browser only.',
        url: 'sponsormybody.com',
        amount: '$1,000',
        views: '0',
        image,
      }

      BRANDS.push(brand)

      const tile = document.createElement('button')
      tile.type = 'button'
      tile.className = 'patchcard'
      tile.dataset.brandId = brand.id
      const swatch = createPatchCanvas(brand, { size: 168 })
      swatch.style.width = '100%'
      swatch.style.height = 'auto'
      tile.append(swatch)
      const label = document.createElement('span')
      label.textContent = brand.label
      tile.append(label)
      tile.addEventListener('click', () => {
        const arming = studio.armed?.id !== brand.id
        studio.setArmed(arming ? brand : null)
      })
      brandsGrid.prepend(tile)

      studio.setArmed(brand)
    } catch {
      hint.textContent = 'That file could not be read as an image'
    }
  }

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files)
    fileInput.value = ''
  })

  for (const event of ['dragenter', 'dragover']) {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault()
      dropzone.classList.add('is-over')
    })
  }
  for (const event of ['dragleave', 'drop']) {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault()
      dropzone.classList.remove('is-over')
    })
  }
  dropzone.addEventListener('drop', (e) => handleFiles(e.dataTransfer?.files))

  /* -------------------------------------------------------------------- fit */

  const syncOutputs = () => {
    sizeOut.textContent = cm(sizeInput.value)
    rotOut.textContent = `${rotInput.value}°`
    opacityOut.textContent = `${opacityInput.value}%`
  }

  sizeInput.addEventListener('input', () => {
    syncOutputs()
    studio.updateSettings({ sizeCm: Number(sizeInput.value) })
  })
  rotInput.addEventListener('input', () => {
    syncOutputs()
    studio.updateSettings({ rotationDeg: Number(rotInput.value) })
  })
  opacityInput.addEventListener('input', () => {
    syncOutputs()
    studio.updateSettings({ opacity: Number(opacityInput.value) })
  })

  /* ------------------------------------------------------------ sponsor card */

  const renderCard = ({ focusedId, items }) => {
    const item = focusedId ? items.find((entry) => entry.id === focusedId) : null
    panel.classList.toggle('is-brand', !!item)
    if (!item) return

    const brand = item.brand
    cardTitle.textContent = item.def.label
    cardViews.textContent = `${parseCount(brand.views).toLocaleString('en-US')} views`
    cardLogo.src = logoDataUrl(brand, 256)
    cardLogo.alt = `${brand.label} logo`
    cardBrand.textContent = brand.label
    cardHandle.textContent = brand.handle
    cardBlurb.textContent = brand.blurb
    cardLink.textContent = `${brand.url} ↗`
    cardLink.href = `https://${brand.url}`
    cardAmount.textContent = brand.amount
  }

  /* ------------------------------------------------------------------ render */

  let noticeTimer = null

  studio.onNotice = (message) => {
    hint.classList.remove('is-armed')
    hint.textContent = message
    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => renderHint(studio.armed), 3200)
  }

  const renderHint = (armed) => {
    if (armed) {
      hint.classList.add('is-armed')
      hint.textContent = `Now tap a spot to place ${armed.label}.`
    } else {
      hint.classList.remove('is-armed')
      hint.textContent = 'Tap a spot on the body to open its sponsor.'
    }
  }

  const renderArmed = ({ armed }) => {
    for (const tile of brandsGrid.children) {
      tile.classList.toggle('is-active', armed?.id === tile.dataset.brandId)
    }
    renderHint(armed)
  }

  const renderSettings = ({ settings, focusedId }) => {
    sizeInput.value = String(Math.round(settings.sizeCm))
    rotInput.value = String(Math.round(settings.rotationDeg))
    opacityInput.value = String(Math.round(settings.opacity))
    syncOutputs()

    const enabled = !!focusedId
    sizeInput.disabled = !enabled
    rotInput.disabled = !enabled
    opacityInput.disabled = !enabled
  }

  studio.onChange((payload) => {
    renderZones(payload)
    renderArmed(payload)
    renderSettings(payload)
    renderCard(payload)
  })

  buildBrands()
  sizeInput.min = String(config.minSizeCm)
  sizeInput.max = String(config.maxSizeCm)
  syncOutputs()
  renderHint(null)
  renderSettings({ settings: studio.settings, focusedId: null })
  renderZones({ items: [], hoveredId: null, focusedId: null })

  return { setOpen }
}
