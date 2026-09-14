/** Procedural UI click — WebAudio only, no audio assets to ship. */

let ctx = null

const ensureCtx = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Short tactile blip for spot taps. Safe to call from any click handler. */
export function playClick() {
  try {
    const ac = ensureCtx()
    if (!ac) return
    const t = ac.currentTime
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(2200, t)
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.06)
    gain.gain.setValueAtTime(0.12, t)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07)
    osc.connect(gain).connect(ac.destination)
    osc.start(t)
    osc.stop(t + 0.08)
  } catch {
    // Audio must never break the UI.
  }
}

let delegated = false

/**
 * Plays the click on every CTA press app-wide via one delegated listener.
 * Canvas taps on the body are not <button> clicks — those call playClick()
 * directly at their own call sites.
 */
export function initClickSounds() {
  if (delegated) return
  delegated = true
  document.addEventListener('click', (event) => {
    if (event.target?.closest?.('button')) playClick()
  })
}

/* ------------------------------------------------------- background music */

const MUSIC_VIDEO_ID = '0yD3NkwQIiU'
const MUSIC_LIST_ID = 'RD0yD3NkwQIiU'
const MUSIC_VOLUME = 30
const MUSIC_PREF_KEY = 'smb-music'

let ytApiPromise = null
let ytPlayer = null
let ytCreating = false
let musicButton = null
let musicWanted = false
let musicPlaying = false

// Stays armed until the mix is actually heard — a tap that lands before the
// YouTube API finishes loading can't unlock audio, so later taps retry.

const loadYtApi = () => {
  if (window.YT?.Player) return Promise.resolve()
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady
      window.onYouTubeIframeAPIReady = () => {
        try {
          prev?.()
        } catch {
          // Ignore host-page handlers.
        }
        resolve()
      }
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      document.head.append(tag)
    })
  }
  return ytApiPromise
}

const syncMusicButton = () => {
  if (!musicButton) return
  musicButton.classList.toggle('is-on', musicWanted)
  musicButton.setAttribute('aria-pressed', String(musicWanted))
}

const startPlayback = () => {
  if (!ytPlayer?.playVideo) return
  try {
    ytPlayer.setVolume(MUSIC_VOLUME)
    ytPlayer.playVideo()
  } catch {
    // Player not ready — the onReady handler starts it instead.
  }
}

const ensurePlayer = async () => {
  await loadYtApi().catch(() => null)
  if (!window.YT?.Player || ytPlayer || ytCreating) return
  ytCreating = true
  try {
    ytPlayer = new window.YT.Player('js-ytplayer', {
      height: '2',
      width: '2',
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        loop: 1,
        rel: 0,
        listType: 'playlist',
        list: MUSIC_LIST_ID,
      },
      events: {
        onReady: (event) => {
          try {
            event.target.setVolume(MUSIC_VOLUME)
            if (musicWanted) event.target.playVideo()
          } catch {
            // Playback starts on the next toggle instead.
          }
        },
        onStateChange: (event) => {
          // CUED (-1-ish/5) means the mix loaded but hasn't started.
          if (musicWanted && event.data === window.YT.PlayerState.CUED) startPlayback()
          if (event.data === window.YT.PlayerState.PLAYING) {
            musicPlaying = true
            window.removeEventListener('pointerdown', startPlaybackIfReady)
          } else if (event.data === window.YT.PlayerState.PAUSED) {
            musicPlaying = false
          }
        },
        onError: () => {
          // Mixes sometimes refuse embeds — fall back to the single video loop.
          try {
            ytPlayer.setLoop(true)
            ytPlayer.loadVideoById(MUSIC_VIDEO_ID)
          } catch {
            // No audio; the toggle simply stays visual.
          }
        },
      },
    })
  } catch {
    ytPlayer = null
  } finally {
    ytCreating = false
  }
};

/** True while the visitor wants music (player may still be loading). */
export function isMusicOn() {
  return musicWanted
}

/** Flips background music. Must run in a user gesture (autoplay policy). */
export function toggleMusic() {
  musicWanted = !musicWanted
  try {
    localStorage.setItem(MUSIC_PREF_KEY, musicWanted ? 'on' : 'off')
  } catch {
    // Private mode — the toggle still works for this visit.
  }
  syncMusicButton()
  if (musicWanted) {
    ensurePlayer().then(startPlayback)
    window.addEventListener('pointerdown', startPlaybackIfReady)
  } else if (ytPlayer?.pauseVideo) {
    musicPlaying = false
    try {
      ytPlayer.pauseVideo()
    } catch {
      // Already stopped.
    }
  }
  return musicWanted
}

/**
 * Wires the HUD music toggle. Music plays by default: an autoplay attempt
 * runs on boot, with a first-tap-anywhere retry for browsers that block
 * unmuted autoplay. The visitor can still switch it off (persisted).
 */
export function initBackgroundMusic(button) {
  musicButton = button ?? null
  try {
    musicWanted = localStorage.getItem(MUSIC_PREF_KEY) !== 'off'
  } catch {
    musicWanted = true
  }
  syncMusicButton()
  // Boot attempt (usually blocked until a gesture) + retry on every tap
  // anywhere until the mix is actually playing.
  startPlaybackIfReady()
  window.addEventListener('pointerdown', startPlaybackIfReady)
}

const startPlaybackIfReady = () => {
  if (!musicWanted || musicPlaying) return
  ensurePlayer().then(startPlayback)
}
