'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import type { SessionState } from '@/lib/gavel/types'

// Sound cues and alerts for the moments a bidder must not miss: being
// outbid, the clock running down, and the hammer falling. Sounds are
// synthesized with Web Audio, so there is nothing to download and nothing
// for the Zoom client's allow list to block.

export type CueSound = 'open' | 'lead' | 'outbid' | 'low' | 'tick' | 'gavel' | 'win'
export type Alert = { id: number; tone: 'outbid' | 'good' | 'info'; title: string; detail?: string }

const MUTE_KEY = 'gavel-muted'
const ALERT_MS = 4500

let context: AudioContext | null = null
let muted = false
let mutedLoaded = false
const muteListeners = new Set<() => void>()

function loadMuted() {
  if (mutedLoaded) return
  mutedLoaded = true
  try {
    muted = window.localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    muted = false
  }
}

// Browsers only start audio after a gesture, so the context is created (or
// resumed) on the first tap or key press anywhere on the page.
function unlock() {
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      context = new Ctor()
    }
    if (context.state === 'suspended') void context.resume()
  } catch {
    context = null
  }
}

function tone(
  ctx: AudioContext,
  { freq, at = 0, dur, type = 'sine', gain = 0.16, glideTo }: { freq: number; at?: number; dur: number; type?: OscillatorType; gain?: number; glideTo?: number },
) {
  const start = ctx.currentTime + at
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  osc.connect(amp).connect(ctx.destination)
  osc.start(start)
  osc.stop(start + dur + 0.02)
}

// One knock of the gavel: a short filtered noise crack over a low thump.
function knock(ctx: AudioContext, at: number) {
  const start = ctx.currentTime + at
  const length = Math.floor(ctx.sampleRate * 0.09)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // Deterministic noise: a fixed generator, so every knock sounds the same.
  let seed = 22695477
  for (let i = 0; i < length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0
    data[i] = ((seed / 0xffffffff) * 2 - 1) * (1 - i / length) ** 2
  }
  const noise = ctx.createBufferSource()
  noise.buffer = buffer
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1800
  const amp = ctx.createGain()
  amp.gain.setValueAtTime(0.5, start)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + 0.09)
  noise.connect(filter).connect(amp).connect(ctx.destination)
  noise.start(start)
  tone(ctx, { freq: 150, glideTo: 70, at, dur: 0.16, type: 'sine', gain: 0.5 })
}

export function playCue(sound: CueSound) {
  loadMuted()
  if (muted || !context || context.state !== 'running') return
  const ctx = context
  try {
    switch (sound) {
      case 'open':
        tone(ctx, { freq: 880, dur: 0.5, type: 'triangle', gain: 0.14 })
        tone(ctx, { freq: 1320, at: 0.09, dur: 0.6, type: 'sine', gain: 0.08 })
        break
      case 'lead':
        tone(ctx, { freq: 523, dur: 0.12, type: 'triangle' })
        tone(ctx, { freq: 784, at: 0.1, dur: 0.2, type: 'triangle' })
        break
      case 'outbid':
        tone(ctx, { freq: 622, dur: 0.14, type: 'triangle', gain: 0.2 })
        tone(ctx, { freq: 415, at: 0.13, dur: 0.26, type: 'triangle', gain: 0.2 })
        break
      case 'low':
        tone(ctx, { freq: 988, dur: 0.09, type: 'square', gain: 0.07 })
        tone(ctx, { freq: 988, at: 0.16, dur: 0.09, type: 'square', gain: 0.07 })
        break
      case 'tick':
        tone(ctx, { freq: 1200, dur: 0.035, type: 'square', gain: 0.05 })
        break
      case 'gavel':
        knock(ctx, 0)
        knock(ctx, 0.2)
        break
      case 'win':
        knock(ctx, 0)
        knock(ctx, 0.2)
        ;[523, 659, 784, 1047].forEach((freq, i) => tone(ctx, { freq, at: 0.45 + i * 0.1, dur: 0.32, type: 'triangle', gain: 0.15 }))
        break
    }
  } catch {
    // Sound is a nicety; a failed cue must never break bidding.
  }
}

function subscribeMute(listener: () => void) {
  muteListeners.add(listener)
  return () => muteListeners.delete(listener)
}

export function useMuted() {
  const value = useSyncExternalStore(
    subscribeMute,
    () => {
      loadMuted()
      return muted
    },
    () => false,
  )
  const toggle = useCallback(() => {
    loadMuted()
    muted = !muted
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    } catch {
      // Storage blocked: the choice still holds for this visit.
    }
    for (const listener of muteListeners) listener()
    if (!muted) {
      unlock()
      playCue('lead')
    }
  }, [])
  return [value, toggle] as const
}

function shortName(name: string) {
  return name.split(' · ')[0] || name
}

// Watches the auction and raises a sound and an alert on each change that
// matters to this viewer. Nothing fires for the state the panel opens on.
export function useCues(state: SessionState | null, selfKey: string | null) {
  const [alert, setAlert] = useState<Alert | null>(null)
  const seen = useRef<{ roundNo: number; status: string; leaderKey: string | null } | null>(null)
  const nextId = useRef(1)

  useEffect(() => {
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (!alert) return
    const id = setTimeout(() => setAlert((current) => (current?.id === alert.id ? null : current)), ALERT_MS)
    return () => clearTimeout(id)
  }, [alert])

  const session = state?.session ?? null
  const roundNo = session?.roundNo ?? 0
  const status = session?.status ?? 'idle'
  const leaderKey = session?.leader?.bidderKey ?? null
  const leaderName = session?.leader ? shortName(session.leader.name) : null
  const price = session?.currentBid ?? 0
  const itemName = session?.itemName ?? ''
  const sold = session ? session.leader !== null && session.reserveMet : false
  const boughtNow = session?.boughtNow ?? false

  useEffect(() => {
    if (!session) return
    const before = seen.current
    seen.current = { roundNo, status, leaderKey }
    if (!before) return
    const raise = (next: Omit<Alert, 'id'>) => setAlert({ id: nextId.current++, ...next })

    // A new lot opens.
    if (status === 'open' && (before.status !== 'open' || before.roundNo !== roundNo)) {
      playCue('open')
      raise({ tone: 'info', title: 'Bidding is open', detail: itemName })
      return
    }
    // The hammer falls.
    if (status === 'closed' && before.status === 'open' && before.roundNo === roundNo) {
      const youWon = sold && selfKey !== null && leaderKey === selfKey
      playCue(youWon ? 'win' : 'gavel')
      if (youWon) {
        raise({ tone: 'good', title: 'You won it', detail: `${itemName} for ${formatUsd(price)}` })
      } else if (sold) {
        raise({ tone: 'info', title: `Sold to ${leaderName}`, detail: `${formatUsd(price)}${boughtNow ? ' with Buy Now' : ''}` })
      } else {
        raise({ tone: 'info', title: 'Not sold', detail: itemName })
      }
      return
    }
    // The lead changes hands while the round is live.
    if (status === 'open' && before.roundNo === roundNo && before.leaderKey !== leaderKey && selfKey !== null) {
      if (before.leaderKey === selfKey) {
        playCue('outbid')
        raise({ tone: 'outbid', title: "You've been outbid", detail: `${leaderName} bid ${formatUsd(price)}` })
      } else if (leaderKey === selfKey) {
        playCue('lead')
      }
    }
  }, [session, roundNo, status, leaderKey, leaderName, price, itemName, sold, boughtNow, selfKey])

  const dismiss = useCallback(() => setAlert(null), [])
  return { alert, dismiss }
}
