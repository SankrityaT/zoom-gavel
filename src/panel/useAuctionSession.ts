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
  type SessionRow,
  type SessionState,
} from '@/lib/gavel/types'

export type SyncPhase =
  | { phase: 'unconfigured' }
  | { phase: 'connecting' }
  | { phase: 'live'; state: SessionState }
  | { phase: 'error'; message: string }

export type AuctionSessionHook = {
  sync: SyncPhase
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
const MAX_BIDS = 50

function mergeBids(existing: Bid[], incoming: Bid[]) {
  const byId = new Map<number, Bid>()
  for (const b of existing) byId.set(b.id, b)
  for (const b of incoming) byId.set(b.id, b)
  return Array.from(byId.values())
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_BIDS)
}

// Transport: 1s polling when websockets are unavailable (forced inside the
// Zoom client), realtime subscriptions everywhere else. Every accepted
// update passes a monotonic guard on session.updatedAt, and bids merge by
// id, so no path can regress the view.
export function useAuctionSession(
  sessionKey: string,
  bidderName: string,
  forcePolling: boolean,
): AuctionSessionHook {
  const [sync, setSync] = useState<SyncPhase>(
    supabaseConfigured() ? { phase: 'connecting' } : { phase: 'unconfigured' },
  )
  const [extendedAt, setExtendedAt] = useState<number | null>(null)
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

  const applySessionRow = useCallback(
    (row: SessionRow) => {
      const current = latestState.current
      if (!current) return
      if (row.updated_at <= latestUpdatedAt.current) return
      latestUpdatedAt.current = row.updated_at
      noteExtension(row.ends_at, row.status)
      const session = toSessionInfo(row)
      const merged: SessionState = {
        ...current,
        session,
        bids: session.roundNo !== current.session.roundNo ? [] : current.bids,
      }
      latestState.current = merged
      setSync({ phase: 'live', state: merged })
    },
    [noteExtension],
  )

  const applyBidRow = useCallback((row: BidRow, roundNo: number) => {
    const current = latestState.current
    if (!current || roundNo !== current.session.roundNo) return
    const merged: SessionState = { ...current, bids: mergeBids(current.bids, [toBid(row)]) }
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
    let teardownRealtime: (() => void) | null = null

    function startPolling() {
      if (!active || pollId !== null) return
      void loadOrCreate()
      pollId = setInterval(() => {
        if (active) void refresh()
      }, 1000)
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
              applySessionRow(payload.record)
            }
          })
          .on('broadcast', { event: 'INSERT' }, (message) => {
            if (!active) return
            const payload = message.payload as { table?: string; record?: BidRow & { round_no: number } }
            if (payload?.table === 'auction_bids' && payload.record?.id) {
              applyBidRow(payload.record, payload.record.round_no)
            }
          })
          .subscribe((status) => {
            if (!active) return
            if (status === 'SUBSCRIBED') void loadOrCreate()
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') startPolling()
          })
        teardownRealtime = () => {
          void supabase.removeChannel(channel)
        }
        if (!active) teardownRealtime()
        resyncId = setInterval(() => {
          if (active) void refresh()
        }, RESYNC_MS)
      } catch {
        startPolling()
      }
    }

    if (forcePolling || typeof WebSocket === 'undefined') startPolling()
    else void startRealtime()

    return () => {
      active = false
      if (pollId !== null) clearInterval(pollId)
      if (resyncId !== null) clearInterval(resyncId)
      teardownRealtime?.()
    }
  }, [sessionKey, forcePolling, loadOrCreate, refresh, applySessionRow, applyBidRow])

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

  return { sync, selfKey, now, extendedAt, placeBid, startRound, stopRound, refresh }
}
