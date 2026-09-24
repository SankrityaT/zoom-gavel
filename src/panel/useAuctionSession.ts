'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserClient, supabaseConfigured } from '@/lib/gavel/browser'
import {
  fetchState,
  initSession,
  postBid,
  startRound as apiStartRound,
  stopRound as apiStopRound,
  type BidResult,
  type RoundResult,
  type StartRoundInput,
} from '@/lib/gavel/client-api'
import { DEMO_LOT_NAME, DEMO_OPENING_BID, anonBidderKey, describeError } from '@/lib/gavel/demo'
import {
  toBid,
  toSessionInfo,
  type Bid,
  type BidRow,
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
  startRound: (input: StartRoundInput) => Promise<RoundResult>
  stopRound: () => Promise<RoundResult>
  refresh: () => Promise<void>
}

const RESYNC_MS = 30_000
// After a stream failure the client polls, then retries the stream with
// jittered exponential backoff so a hiccup never pins it to polling.
const STREAM_RETRY_BASE_MS = 15_000
const STREAM_RETRY_MAX_MS = 120_000
const MAX_BIDS = 50

function mergeBids(existing: Bid[], incoming: Bid[]) {
  const byId = new Map<number, Bid>()
  for (const b of existing) byId.set(b.id, b)
  for (const b of incoming) byId.set(b.id, b)
  return Array.from(byId.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_BIDS)
}

// Transport ladder: direct Supabase Realtime, then Server-Sent Events from
// our own origin, then 1s polling. Inside Zoom the ladder starts at SSE:
// the webview's websocket support and domain allow list are out of our
// hands, and supabase-js must never even load there. Every
// accepted update passes a monotonic guard on session.updatedAt, and bids
// merge by id, so no path can regress the view.
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
  const latestUpdatedAt = useRef('')
  const latestState = useRef<SessionState | null>(null)
  const offsetMs = useRef(0)
  const endsAtRef = useRef<string | null>(null)

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
        // Older session snapshot, but the ladder and viewer may still be
        // fresher than what we hold: merge those without touching the session.
        const merged: SessionState = {
          ...current,
          bids: mergeBids(current.bids, next.bids),
          viewer: next.viewer,
          serverNow: next.serverNow,
        }
        latestState.current = merged
        setSync({ phase: 'live', state: merged })
        return
      }
      latestUpdatedAt.current = next.session.updatedAt
      noteExtension(next.session.endsAt, next.session.status)
      const merged: SessionState = {
        ...next,
        bids: current ? mergeBids(current.bids, next.bids) : next.bids,
      }
      // A new round resets the ladder.
      if (current && current.session.roundNo !== next.session.roundNo) {
        merged.bids = next.bids
      }
      latestState.current = merged
      setSync({ phase: 'live', state: merged })
    },
    [noteExtension],
  )

  // Returns true when the change affects what this viewer may do (host
  // claimed or verified), which only a full state read can recompute.
  const applySessionInfo = useCallback(
    (session: SessionInfo) => {
      const current = latestState.current
      if (!current) return false
      if (session.updatedAt <= latestUpdatedAt.current) return false
      latestUpdatedAt.current = session.updatedAt
      noteExtension(session.endsAt, session.status)
      const merged: SessionState = {
        ...current,
        session,
        bids: session.roundNo !== current.session.roundNo ? [] : current.bids,
      }
      latestState.current = merged
      setSync({ phase: 'live', state: merged })
      return (
        session.hostClaimed !== current.session.hostClaimed ||
        session.hostVerified !== current.session.hostVerified
      )
    },
    [noteExtension],
  )

  const applyBid = useCallback((bid: Bid, roundNo: number) => {
    const current = latestState.current
    if (!current || roundNo !== current.session.roundNo) return
    const merged: SessionState = { ...current, bids: mergeBids(current.bids, [bid]) }
    latestState.current = merged
    setSync({ phase: 'live', state: merged })
  }, [])

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
    let teardownPush: (() => void) | null = null

    const onSession = (session: SessionInfo) => {
      if (applySessionInfo(session)) void refresh()
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
        const data = parse(event) as { session?: SessionInfo }
        if (active && data.session) onSession(data.session)
      })
      source.addEventListener('bid', (event) => {
        const data = parse(event) as { bid?: Bid; roundNo?: number }
        if (active && data.bid && typeof data.roundNo === 'number') applyBid(data.bid, data.roundNo)
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
            const payload = message.payload as { table?: string; record?: SessionRow }
            if (payload?.table === 'auction_sessions' && payload.record?.uuid) {
              onSession(toSessionInfo(payload.record))
            }
          })
          .on('broadcast', { event: 'INSERT' }, (message) => {
            if (!active) return
            const payload = message.payload as { table?: string; record?: BidRow & { round_no: number } }
            if (payload?.table === 'auction_bids' && payload.record?.id) {
              applyBid(toBid(payload.record), payload.record.round_no)
            }
          })
          .subscribe((status) => {
            if (!active) return
            if (status === 'SUBSCRIBED') {
              setTransport('realtime')
              void loadOrCreate()
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
      if (streamRetryId !== null) clearTimeout(streamRetryId)
      teardownPush?.()
    }
  }, [sessionKey, inZoom, loadOrCreate, refresh, applyState, applySessionInfo, applyBid])

  useEffect(() => {
    let active = true
    void anonBidderKey(bidderName).then((k) => {
      if (active) setAnonKey(k)
    })
    return () => {
      active = false
    }
  }, [bidderName])

  const now = useCallback(() => Date.now() + offsetMs.current, [])

  const placeBid = useCallback(
    async (amount: number) => {
      const result = await postBid(sessionKey, amount, bidderName)
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

  return { sync, transport, selfKey, now, extendedAt, placeBid, startRound, stopRound, refresh }
}
