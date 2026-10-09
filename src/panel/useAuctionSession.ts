'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserClient, supabaseConfigured } from '@/lib/gavel/browser'
import {
  fetchState,
  initSession,
  postBid,
  postMaxBid,
  type MaxResult,
  startRound as apiStartRound,
  stopRound as apiStopRound,
  type BidResult,
  type RoundResult,
  type StartRoundInput,
} from '@/lib/gavel/client-api'
import { DEMO_LOT_NAME, DEMO_OPENING_BID, anonBidderKey, describeError } from '@/lib/gavel/demo'
import {
  toLeaderboard,
  toSessionInfo,
  type LeaderEntry,
  type LeaderRow,
  type SessionInfo,
  type SessionRow,
  type SessionState,
} from '@/lib/gavel/types'

export type SyncPhase =
  | { phase: 'unconfigured' }
  | { phase: 'connecting' }
  | { phase: 'live'; state: SessionState }
  | { phase: 'error'; message: string }

/** How updates reach this client; null until a transport is chosen. */
export type Transport = 'realtime' | 'stream' | 'polling'

export type AuctionSessionHook = {
  sync: SyncPhase
  transport: Transport | null
  /** This viewer's public bidder key (verified or anonymous), once known. */
  selfKey: string | null
  /** Server-synced wall clock, in ms. */
  now: () => number
  /** Timestamp (ms) of the last clock extension, for a transient toast. */
  extendedAt: number | null
  placeBid: (amount: number) => Promise<BidResult>
  /** This viewer's max bid for the current round, or null. */
  maxBid: number | null
  setMaxBid: (amount: number | null) => Promise<MaxResult>
  /** Takes a state the panel got from another call (the lot queue). */
  absorb: (state: SessionState) => void
  startRound: (input: StartRoundInput) => Promise<RoundResult>
  stopRound: () => Promise<RoundResult>
  refresh: () => Promise<void>
}

const RESYNC_MS = 30_000
// After a stream failure the client polls, then retries the stream with
// jittered exponential backoff so a hiccup never pins it to polling.
const STREAM_RETRY_BASE_MS = 15_000
const STREAM_RETRY_MAX_MS = 120_000
// A broadcast sent just after a realtime channel joins can be lost, so a
// fresh subscription reads the state once more shortly after it opens.
const SETTLE_MS = 1_200

// This browser's own best bid per session, so an unverified bidder still
// sees their amount after a reload. The server cannot tell anonymous
// viewers apart, so it never sends them one.
type OwnBid = { bidderKey: string; roundNo: number; amount: number }

function ownBidStorageKey(sessionKey: string) {
  return `gavel-own:${sessionKey}`
}

function readOwnBid(sessionKey: string): OwnBid | null {
  try {
    const raw = window.sessionStorage.getItem(ownBidStorageKey(sessionKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OwnBid>
    return typeof parsed.bidderKey === 'string' &&
      typeof parsed.roundNo === 'number' &&
      typeof parsed.amount === 'number'
      ? { bidderKey: parsed.bidderKey, roundNo: parsed.roundNo, amount: parsed.amount }
      : null
  } catch {
    return null
  }
}

// An unverified bidder's max bid, remembered the same way and for the same
// reason: the server will not tell an anonymous viewer what theirs is.
function maxStorageKey(sessionKey: string) {
  return `gavel-max:${sessionKey}`
}

function readOwnMax(sessionKey: string): OwnBid | null {
  try {
    const raw = window.sessionStorage.getItem(maxStorageKey(sessionKey))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<OwnBid>
    return typeof parsed.bidderKey === 'string' &&
      typeof parsed.roundNo === 'number' &&
      typeof parsed.amount === 'number'
      ? { bidderKey: parsed.bidderKey, roundNo: parsed.roundNo, amount: parsed.amount }
      : null
  } catch {
    return null
  }
}

function writeOwnMax(sessionKey: string, own: OwnBid | null) {
  try {
    if (own) window.sessionStorage.setItem(maxStorageKey(sessionKey), JSON.stringify(own))
    else window.sessionStorage.removeItem(maxStorageKey(sessionKey))
  } catch {
    // Storage blocked: memory still has it.
  }
}

function writeOwnBid(sessionKey: string, own: OwnBid) {
  try {
    window.sessionStorage.setItem(ownBidStorageKey(sessionKey), JSON.stringify(own))
  } catch {
    // Storage blocked (some embedded webviews): memory still has it.
  }
}

// Transport ladder: direct Supabase Realtime, then Server-Sent Events from
// our own origin, then 1s polling. Inside Zoom the ladder starts at SSE:
// the webview's websocket support and domain allow list are out of our
// hands, and supabase-js must never even load there. Every accepted
// update passes a monotonic guard on session.updatedAt, so no path can
// regress the view.
//
// Bid amounts are private. Pushed leaderboards carry ranks only, so this
// hook fills back in what the viewer is entitled to: their own amount, and
// for the host the amounts from the last full read (refreshed right after).
export function useAuctionSession(
  sessionKey: string,
  bidderName: string,
  inZoom: boolean,
): AuctionSessionHook {
  const [sync, setSync] = useState<SyncPhase>(
    supabaseConfigured() ? { phase: 'connecting' } : { phase: 'unconfigured' },
  )
  const [extendedAt, setExtendedAt] = useState<number | null>(null)
  const [transport, setTransport] = useState<Transport | null>(null)
  const [anonKey, setAnonKey] = useState<string | null>(null)
  const [localMax, setLocalMax] = useState<OwnBid | null>(() =>
    typeof window === 'undefined' ? null : readOwnMax(sessionKey),
  )
  const latestUpdatedAt = useRef('')
  const latestState = useRef<SessionState | null>(null)
  const offsetMs = useRef(0)
  const endsAtRef = useRef<string | null>(null)
  const anonKeyRef = useRef<string | null>(null)
  const ownBid = useRef<OwnBid | null>(null)
  const ownBidLoaded = useRef(false)

  const reveal = useCallback(
    (state: SessionState, previous: SessionState | null): SessionState => {
      if (!ownBidLoaded.current) {
        ownBidLoaded.current = true
        ownBid.current = readOwnBid(sessionKey)
      }
      const roundNo = state.session.roundNo
      const self =
        (state.viewer.verified ? state.viewer.bidderKey : null) ?? anonKeyRef.current
      // A full read may name this viewer's amount: remember it for pushes.
      const mine = state.leaderboard.find((e) => e.bidderKey === self && e.amount !== null)
      if (self && mine && mine.amount !== null) {
        ownBid.current = { bidderKey: self, roundNo, amount: mine.amount }
      }
      // Only ever shown against the identity and round that placed it.
      const own =
        ownBid.current?.roundNo === roundNo && ownBid.current.bidderKey === self
          ? ownBid.current.amount
          : null
      const carried =
        state.viewer.isHost && previous && previous.session.roundNo === roundNo
          ? new Map(previous.leaderboard.map((e) => [e.bidderKey, e.amount]))
          : null
      const fill = (entry: LeaderEntry): LeaderEntry => {
        if (entry.amount !== null) return entry
        const amount = (entry.bidderKey === self ? own : null) ?? carried?.get(entry.bidderKey) ?? null
        return amount === null ? entry : { ...entry, amount }
      }
      return { ...state, leaderboard: state.leaderboard.map(fill) }
    },
    [sessionKey],
  )

  const noteExtension = useCallback((nextEndsAt: string | null, status: string) => {
    const prev = endsAtRef.current
    if (status === 'open' && prev && nextEndsAt && nextEndsAt > prev) {
      setExtendedAt(Date.now())
    }
    endsAtRef.current = nextEndsAt
  }, [])

  const applyState = useCallback(
    (next: SessionState) => {
      offsetMs.current = new Date(next.serverNow).getTime() - Date.now()
      const current = latestState.current
      if (current && next.session.updatedAt < latestUpdatedAt.current) {
        // Older session snapshot: keep what we hold, but the viewer block
        // (host claim, verification) may still be fresher, and a bid this
        // viewer just placed may need filling in.
        const merged = reveal({ ...current, viewer: next.viewer, serverNow: next.serverNow }, current)
        latestState.current = merged
        setSync({ phase: 'live', state: merged })
        return
      }
      latestUpdatedAt.current = next.session.updatedAt
      noteExtension(next.session.endsAt, next.session.status)
      const merged = reveal(next, current)
      latestState.current = merged
      setSync({ phase: 'live', state: merged })
    },
    [noteExtension, reveal],
  )

  // Returns true when only a full state read can finish the update: the
  // host claim changed (what this viewer may do), or this viewer is the
  // host and is owed the amounts a push never carries.
  const applySessionInfo = useCallback(
    (session: SessionInfo, leaderboard: LeaderEntry[]) => {
      const current = latestState.current
      if (!current) return false
      if (session.updatedAt <= latestUpdatedAt.current) return false
      latestUpdatedAt.current = session.updatedAt
      noteExtension(session.endsAt, session.status)
      const merged = reveal({ ...current, session, leaderboard }, current)
      latestState.current = merged
      setSync({ phase: 'live', state: merged })
      return (
        current.viewer.isHost ||
        // A new round resets what is private to this viewer (their max bid).
        session.roundNo !== current.session.roundNo ||
        session.hostClaimed !== current.session.hostClaimed ||
        session.hostVerified !== current.session.hostVerified
      )
    },
    [noteExtension, reveal],
  )

  const loadOrCreate = useCallback(async () => {
    try {
      const existing = await fetchState(sessionKey)
      const state = existing ?? (await initSession(sessionKey, DEMO_LOT_NAME, DEMO_OPENING_BID))
      applyState(state)
    } catch (error) {
      setSync({ phase: 'error', message: describeError(error) })
    }
  }, [sessionKey, applyState])

  const refresh = useCallback(async () => {
    try {
      const state = await fetchState(sessionKey)
      if (state) applyState(state)
    } catch {
      // Transient; the next poll or resync will recover.
    }
  }, [sessionKey, applyState])

  // NOTE: mount with key={sessionKey}; a key change remounts so stale state
  // can never render against, or bid into, a different session.
  useEffect(() => {
    if (!supabaseConfigured()) return
    let active = true
    let pollId: ReturnType<typeof setInterval> | null = null
    let resyncId: ReturnType<typeof setInterval> | null = null
    let settleId: ReturnType<typeof setTimeout> | null = null
    let teardownPush: (() => void) | null = null

    const onSession = (session: SessionInfo, leaderboard: LeaderEntry[]) => {
      if (applySessionInfo(session, leaderboard)) void refresh()
    }

    function startResync() {
      if (resyncId === null) {
        resyncId = setInterval(() => {
          if (active) void refresh()
        }, RESYNC_MS)
      }
    }

    let streamStarted = false
    let streamRetryId: ReturnType<typeof setTimeout> | null = null
    let streamFailures = 0

    function scheduleStreamRetry() {
      if (!active || streamRetryId !== null) return
      const base = Math.min(STREAM_RETRY_MAX_MS, STREAM_RETRY_BASE_MS * 2 ** streamFailures)
      streamFailures += 1
      streamRetryId = setTimeout(() => {
        streamRetryId = null
        if (!active) return
        if (pollId !== null) {
          clearInterval(pollId)
          pollId = null
        }
        streamStarted = false
        void startStream()
      }, base * (1 + Math.random() * 0.25))
    }

    function fallBackFromStream() {
      startPolling()
      scheduleStreamRetry()
    }

    function startPushOrPoll() {
      if (typeof EventSource === 'undefined') startPolling()
      else void startStream()
    }

    function startPolling() {
      if (!active || pollId !== null) return
      teardownPush?.()
      teardownPush = null
      setTransport('polling')
      void loadOrCreate()
      pollId = setInterval(() => {
        if (active) void refresh()
      }, 1000)
    }

    async function startStream() {
      if (streamStarted) return
      streamStarted = true
      teardownPush?.()
      teardownPush = null
      // The stream only reads; make sure the session exists first.
      await loadOrCreate()
      if (!active) return
      const source = new EventSource(
        `/api/session/${encodeURIComponent(sessionKey)}/stream`,
      )
      let failures = 0
      const parse = (event: Event) => JSON.parse((event as MessageEvent<string>).data) as unknown

      source.addEventListener('state', (event) => {
        const state = parse(event) as SessionState | null
        // A delivered snapshot is the proof the stream works end to end.
        streamFailures = 0
        if (active && state) applyState(state)
      })
      source.addEventListener('session', (event) => {
        const data = parse(event) as { session?: SessionInfo; leaderboard?: LeaderEntry[] }
        if (active && data.session) onSession(data.session, data.leaderboard ?? [])
      })
      source.addEventListener('fallback', () => {
        if (active) fallBackFromStream()
      })
      source.onopen = () => {
        failures = 0
        if (active) setTransport('stream')
      }
      // Routine reconnects (the server ends each stream before its time
      // limit) come back through onopen. A refused connection or repeated
      // failures mean this client should poll instead.
      source.onerror = () => {
        failures += 1
        if (active && (source.readyState === EventSource.CLOSED || failures >= 3)) fallBackFromStream()
      }
      teardownPush = () => source.close()
      if (!active) teardownPush()
      startResync()
    }

    async function startRealtime() {
      try {
        const supabase = await getBrowserClient()
        if (!active) return
        // Private per-session broadcast topic fed by DB triggers. Only someone
        // who already knows the key can subscribe; tables are not readable.
        const channel = supabase
          .channel(`session:${sessionKey}`, { config: { private: true } })
          .on('broadcast', { event: 'UPDATE' }, (message) => {
            if (!active) return
            const payload = message.payload as {
              table?: string
              record?: SessionRow
              leaderboard?: LeaderRow[]
            }
            if (payload?.table === 'auction_sessions' && payload.record?.uuid) {
              onSession(
                toSessionInfo(payload.record),
                toLeaderboard(payload.leaderboard ?? [], payload.record.current_bid),
              )
            }
          })
          .subscribe((status) => {
            if (!active) return
            if (status === 'SUBSCRIBED') {
              setTransport('realtime')
              void loadOrCreate()
              if (settleId !== null) clearTimeout(settleId)
              settleId = setTimeout(() => {
                if (active) void refresh()
              }, SETTLE_MS)
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startPushOrPoll()
          })
        teardownPush = () => {
          void supabase.removeChannel(channel)
        }
        if (!active) teardownPush()
        startResync()
      } catch {
        startPushOrPoll()
      }
    }

    if (inZoom || typeof WebSocket === 'undefined') startPushOrPoll()
    else void startRealtime()

    return () => {
      active = false
      if (pollId !== null) clearInterval(pollId)
      if (resyncId !== null) clearInterval(resyncId)
      if (settleId !== null) clearTimeout(settleId)
      if (streamRetryId !== null) clearTimeout(streamRetryId)
      teardownPush?.()
    }
  }, [sessionKey, inZoom, loadOrCreate, refresh, applyState, applySessionInfo])

  useEffect(() => {
    let active = true
    void anonBidderKey(bidderName).then((k) => {
      if (!active) return
      anonKeyRef.current = k
      setAnonKey(k)
      // The key arrived after the first state: fill in this viewer's amount.
      const current = latestState.current
      if (current) {
        const merged = reveal(current, current)
        latestState.current = merged
        setSync({ phase: 'live', state: merged })
      }
    })
    return () => {
      active = false
    }
  }, [bidderName, reveal])

  const now = useCallback(() => Date.now() + offsetMs.current, [])

  const placeBid = useCallback(
    async (amount: number) => {
      const result = await postBid(sessionKey, amount, bidderName)
      if (result.accepted) {
        const viewer = result.state.viewer
        const self = (viewer.verified ? viewer.bidderKey : null) ?? anonKeyRef.current
        if (self) {
          ownBid.current = { bidderKey: self, roundNo: result.state.session.roundNo, amount: result.amount }
          writeOwnBid(sessionKey, ownBid.current)
        }
      }
      if (result.state) applyState(result.state)
      return result
    },
    [sessionKey, bidderName, applyState],
  )

  const startRound = useCallback(
    async (input: StartRoundInput) => {
      const result = await apiStartRound(sessionKey, input)
      if (result.state) applyState(result.state)
      return result
    },
    [sessionKey, applyState],
  )

  const stopRound = useCallback(async () => {
    const result = await apiStopRound(sessionKey)
    if (result.state) applyState(result.state)
    return result
  }, [sessionKey, applyState])

  const selfKey =
    (sync.phase === 'live' && sync.state.viewer.verified ? sync.state.viewer.bidderKey : null) ??
    anonKey

  const setMaxBid = useCallback(
    async (amount: number | null) => {
      const result = await postMaxBid(sessionKey, amount, bidderName)
      if (result.ok) {
        const viewer = result.state.viewer
        const self = (viewer.verified ? viewer.bidderKey : null) ?? anonKeyRef.current
        const next =
          result.max !== null && self
            ? { bidderKey: self, roundNo: result.state.session.roundNo, amount: result.max }
            : null
        setLocalMax(next)
        writeOwnMax(sessionKey, next)
      }
      if (result.state) applyState(result.state)
      return result
    },
    [sessionKey, bidderName, applyState],
  )

  // Verified viewers get their max from the server; everyone else from
  // this browser, and only for the round and identity that set it.
  const live = sync.phase === 'live' ? sync.state : null
  const maxBid = live
    ? live.viewer.verified
      ? live.viewer.maxBid
      : localMax && localMax.roundNo === live.session.roundNo && localMax.bidderKey === selfKey
        ? localMax.amount
        : null
    : null

  return {
    sync,
    transport,
    selfKey,
    now,
    extendedAt,
    placeBid,
    maxBid,
    setMaxBid,
    absorb: applyState,
    startRound,
    stopRound,
    refresh,
  }
}
