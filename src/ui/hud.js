import { leaderboard, site } from '../config.js'
import { paintAvatar, paintFeed } from './placeholders.js'

const pad = (value) => String(Math.max(0, Math.floor(value))).padStart(2, '0')

/* ----------------------------------------------------------- countdown --- */

function initCountdown(root) {
  const offset = site.raceOffset
  const target =
    Date.now() +
    (((offset.days * 24 + offset.hours) * 60 + offset.minutes) * 60 + offset.seconds) * 1000

  const outputs = [...root.querySelectorAll('.countdown__seg b')]

  const render = () => {
    const remaining = Math.max(0, target - Date.now()) / 1000
    const values = [
      pad(Math.floor(remaining / 86400)),
      pad(Math.floor((remaining % 86400) / 3600)),
      pad(Math.floor((remaining % 3600) / 60)),
      pad(Math.floor(remaining % 60)),
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
  time.textContent = entry.time

  li.append(flag, who, time)
  return li
}

function initTicker(root) {
  let cursor = 0

  const render = () => {
    root.replaceChildren(
      ...Array.from({ length: VISIBLE_ROWS }, (_, index) =>
        tickerRow(leaderboard[(cursor + index) % leaderboard.length], index),
      ),
    )
  }

  render()

  // A slow shuffle so the board reads as live activity. Purely cosmetic.
  // Countries rotate once every 5 seconds.
  return setInterval(() => {
    cursor = (cursor + 1) % leaderboard.length
    root.prepend(tickerRow(leaderboard[(cursor + VISIBLE_ROWS - 1) % leaderboard.length], 0))
    while (root.children.length > VISIBLE_ROWS) root.lastElementChild.remove()
  }, 5000)
}

/* ------------------------------------------------------------------ hud --- */

export function initHud({ onResetCamera, onToggleSponsors }) {
  document.querySelector('#js-earnings').textContent = site.earnings
  document.querySelector('#js-bidding').textContent = site.biddingLabel

  const timers = [
    initCountdown(document.querySelector('#js-countdown')),
    initTicker(document.querySelector('#js-ticker')),
  ]

  paintAvatar(document.querySelector('#js-avatar'))
  paintFeed(document.querySelector('#js-feed'))

  const mute = document.querySelector('#js-mute')
  mute.addEventListener('click', () => {
    const off = mute.getAttribute('aria-pressed') !== 'true'
    mute.setAttribute('aria-pressed', String(off))
    mute.classList.toggle('is-off', off)
  })

  document.querySelector('#js-full').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else document.documentElement.requestFullscreen?.()
  })

  const stream = document.querySelector('#js-stream')
  stream.addEventListener('click', () => stream.classList.toggle('is-on'))

  document.querySelector('#js-reset').addEventListener('click', onResetCamera)
  document.querySelector('#js-how').addEventListener('click', () => {
    document.querySelector('#js-hint').textContent =
      'Pick a patch, then tap the body to stick it on.'
  })
  document.querySelector('#js-sponsors').addEventListener('click', onToggleSponsors)

  return {
    dispose() {
      timers.forEach(clearInterval)
    },
  }
}
