import { leaderboard, profile, site } from '../config.js'
import { fetchLiveLeaderboard, fetchTickerCountries } from '../lib/bidding.js'
import { avatarPhoto } from './placeholders.js'

const pad = (value) => String(Math.max(0, Math.floor(value))).padStart(2, '0')

/* ----------------------------------------------------------- countdown --- */

function initCountdown(root) {
  // Fixed start instant from config, so every device shows the same elapsed time.
  const started = Date.parse(site.raceStartUtc)

  const outputs = [...root.querySelectorAll('.countdown__seg b')]

  // Counts up from page load — time since the race clock started.
  const render = () => {
    const elapsed = Math.max(0, Date.now() - started) / 1000
    const values = [
      pad(Math.floor(elapsed / 86400)),
      pad(Math.floor((elapsed % 86400) / 3600)),
      pad(Math.floor((elapsed % 3600) / 60)),
      pad(Math.floor(elapsed % 60)),
    ]

    outputs.forEach((node, index) => {
      const next = values[index] ?? '00'
      if (node.textContent !== next) node.textContent = next
    })
  }

  render()
  return setInterval(render, 1000)
}

/* -------------------------------------------------------------- ticker --- */

const VISIBLE_ROWS = 4

/** Clocks read in the visitor's own timezone, not each country's. */
const visitorTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'

const visitorFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: visitorTz,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Short zone label for the visitor (IST, EST, JST … or a GMT offset). */
const visitorCode = (() => {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: visitorTz,
      timeZoneName: 'short',
    }).formatToParts(new Date())
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? visitorTz
  } catch {
    return visitorTz
  }
})()

function liveTime() {
  try {
    return visitorFmt.format(new Date())
  } catch {
    return '--:--'
  }
}

function tickerRow(entry, index) {
  const li = document.createElement('li')
  li.style.animationDelay = `${index * 40}ms`

  const flag = document.createElement('span')
  flag.className = 'flag'
  flag.textContent = entry.flag

  const who = document.createElement('span')
  who.className = 'who'
  who.textContent = entry.name

  const time = document.createElement('span')
  time.className = 't'
  time.textContent = `${liveTime()} ${visitorCode}`
  time.title = visitorTz

  li.append(flag, who, time)
  return li
}

function initTicker(root) {
  // Countries always stay on the board — paid bids join them, never replace them.
  let board = [...leaderboard]
  let cursor = 0
  let elapsed = 0

  const visibleRows = () =>
    board.length <= VISIBLE_ROWS
      ? board
      : Array.from({ length: VISIBLE_ROWS }, (_, index) => board[(cursor + index) % board.length])

  const render = () => {
    root.replaceChildren(...visibleRows().map((entry, index) => tickerRow(entry, index)))
  }

  // Refreshes the clocks in place every second; countries rotate every 5th tick.
  const refreshTimes = () => {
    const rows = visibleRows()
    for (let i = 0; i < rows.length; i += 1) {
      const node = root.children[i]?.querySelector('.t')
      if (node) node.textContent = `${liveTime()} ${visitorCode}`
    }
  }

  render()

  // A slow shuffle so the board reads as live activity. Purely cosmetic.
  // Countries rotate once every 5 seconds; clocks tick every second.
  const spinTimer = setInterval(() => {
    elapsed += 1
    if (elapsed % 5 === 0 && board.length > VISIBLE_ROWS) {
      cursor = (cursor + 1) % board.length
      root.prepend(tickerRow(board[(cursor + VISIBLE_ROWS - 1) % board.length], 0))
      while (root.children.length > VISIBLE_ROWS) root.lastElementChild.remove()
    }
    refreshTimes()
  }, 1000)

  // Paid bids lead, then the DB country list, then the baked-in list —
  // the countries are never swapped out, so paid activity joins the board
  // instead of hiding it.
  const pullBoard = async () => {
    try {
      const live = await fetchLiveLeaderboard()
      const countries = await fetchTickerCountries()
      const base = countries?.length ? countries : [...leaderboard]
      board = live?.length ? [...live, ...base] : base
      cursor = 0
      render()
    } catch {
      // Offline or backend off — the static board keeps ticking.
    }
  }
  pullBoard()
  const liveTimer = setInterval(pullBoard, 30000)

  return [spinTimer, liveTimer]
}

/* ------------------------------------------------------------------ hud --- */

export function initHud({ onResetCamera, onToggleSponsors }) {
  const timers = [
    initCountdown(document.querySelector('#js-countdown')),
    ...initTicker(document.querySelector('#js-ticker')),
  ]

  avatarPhoto(document.querySelector('#js-avatar'), profile.photo)

  document.querySelector('#js-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  })

  const stream = document.querySelector('#js-stream')
  stream.addEventListener('click', () => stream.classList.toggle('is-on'))

  document.querySelector('#js-reset').addEventListener('click', onResetCamera)
  document.querySelector('#js-sponsors').addEventListener('click', onToggleSponsors)

  return {
    dispose() {
      timers.forEach(clearInterval)
    },
  }
}
