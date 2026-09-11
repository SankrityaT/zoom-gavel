'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getBrowserClient, supabaseConfigured } from '@/lib/gavel/browser'
import { fetchSession, initSession, postBid } from '@/lib/gavel/client-api'
import {
  BID_STEP,
  DEMO_LOT_NAME,
  DEMO_OPENING_BID,
  describeError,
  formatUsd,
} from '@/lib/gavel/demo'
import { toSession, type AuctionSession, type AuctionSessionRow } from '@/lib/gavel/types'

type Props = {
  /** Sanitized session key (base64url), safe for URL paths and realtime filters. */
  sessionKey: string
  /** Human label for where this session came from. */
  sessionLabel: string
  bidderId: string
  /**
   * Skip websockets entirely and poll. Set inside the Zoom client, whose
   * webview lacks a working WebSocket implementation; detection there is
   * unreliable, so the caller decides deterministically.
   */
  forcePolling?: boolean
}

type SyncState =
  | { phase: 'unconfigured' }
  | { phase: 'connecting' }
  | { phase: 'live'; session: AuctionSession }
  | { phase: 'error'; message: string }

export default function LiveBidSync({
  sessionKey,
  sessionLabel,
  bidderId,
  forcePolling = false,
}: Props) {
  const [state, setState] = useState<SyncState>(
    supabaseConfigured() ? { phase: 'connecting' } : { phase: 'unconfigured' },
  )
  const [bidMessage, setBidMessage] = useState('')
  const [placing, setPlacing] = useState(false)
  // Monotonic guard: never let an older snapshot overwrite a newer one.
  const latestUpdatedAt = useRef<string>('')

  const applySession = useCallback((session: AuctionSession) => {
    if (session.updatedAt <= latestUpdatedAt.current) return
    latestUpdatedAt.current = session.updatedAt
    setBidMessage('')
    setState({ phase: 'live', session })
  }, [])

  // NOTE: mount this component with key={sessionKey}. A key change
  // remounts it, which is what guarantees stale state from a previous
  // session can never render against, or bid into, the new one.
  useEffect(() => {
    if (!supabaseConfigured()) return
    let active = true
    let pollId: ReturnType<typeof setInterval> | null = null

    async function loadOrCreate() {
      try {
        const existing = await fetchSession(sessionKey)
        const session =
          existing ??
          (await initSession(sessionKey, DEMO_LOT_NAME, DEMO_OPENING_BID))
        if (active) applySession(session)
      } catch (error) {
        if (active) setState({ phase: 'error', message: describeError(error) })
      }
    }

    // Fallback for environments without websockets, notably the Zoom
    // desktop webview, which does not expose the WebSocket global at all.
    // Fast polling is a documented MVP shortcut there, not the default:
    // regular browsers still get true push.
    function startPolling() {
      if (!active || pollId !== null) return
      console.info('LiveBidSync: websockets unavailable, using 1s polling')
      void loadOrCreate()
      pollId = setInterval(() => {
        if (!active) return
        fetchSession(sessionKey)
          .then((session) => {
            if (active && session) applySession(session)
          })
          .catch(() => {
            // Transient poll failures are retried on the next tick.
          })
      }, 1000)
    }

    let teardownRealtime: (() => void) | null = null

    async function startRealtime() {
      try {
        // Dynamic import: never evaluated on the polling path.
        const supabase = await getBrowserClient()
        if (!active) return
        const channel = supabase
          .channel(`session-${sessionKey}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'auction_sessions',
              filter: `uuid=eq.${sessionKey}`,
            },
            (payload) => {
              if (!active) return
              const row = payload.new as AuctionSessionRow
              if (row?.uuid) applySession(toSession(row))
            },
          )
          .subscribe((status) => {
            if (!active) return
            if (status === 'SUBSCRIBED') {
              // Fresh subscription (or reconnect after a drop): refetch so
              // any update missed while disconnected is reconciled.
              void loadOrCreate()
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              // Realtime is unusable here: degrade to polling instead of
              // showing a dead panel.
              startPolling()
            }
          })
        teardownRealtime = () => {
          void supabase.removeChannel(channel)
        }
        if (!active) teardownRealtime()
      } catch {
        startPolling()
      }
    }

    if (forcePolling || typeof WebSocket === 'undefined') {
      startPolling()
    } else {
      void startRealtime()
    }

    return () => {
      active = false
      if (pollId !== null) clearInterval(pollId)
      teardownRealtime?.()
    }
  }, [sessionKey, applySession, forcePolling])

  const placeBid = useCallback(async () => {
    if (state.phase !== 'live' || placing) return
    setPlacing(true)
    setBidMessage('')
    const amount = state.session.currentBid + BID_STEP
    try {
      const result = await postBid(sessionKey, amount, bidderId)
      if (result.outcome === 'rejected') {
        setBidMessage('Outbid or auction closed. Syncing latest state...')
        const fresh = await fetchSession(sessionKey)
        if (fresh) applySession(fresh)
      } else {
        applySession(result.session)
        setBidMessage(`Bid ${formatUsd(amount)} accepted.`)
      }
    } catch (error) {
      setBidMessage(`Bid did not reach the server: ${describeError(error)}`)
    } finally {
      setPlacing(false)
    }
  }, [state, placing, sessionKey, bidderId, applySession])

  if (state.phase === 'unconfigured') {
    return (
      <section className="live-sync" aria-labelledby="live-sync-title">
        <p className="context-label" id="live-sync-title">
          LIVE BID SYNC
        </p>
        <p>
          Backend not configured: set NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
        </p>
      </section>
    )
  }

  const closed = state.phase === 'live' && state.session.status === 'closed'

  return (
    <section className="live-sync" aria-labelledby="live-sync-title">
      <div className="section-heading">
        <p className="context-label" id="live-sync-title">
          LIVE BID SYNC
        </p>
        <span>{forcePolling ? `${sessionLabel} · 1s polling` : sessionLabel}</span>
      </div>

      {state.phase === 'connecting' && <p>Connecting to session…</p>}
      {state.phase === 'error' && <p role="alert">Sync error: {state.message}</p>}

      {state.phase === 'live' && (
        <>
          <dl>
            <div>
              <dt>Session</dt>
              <dd className="live-sync-id">{sessionKey}</dd>
            </div>
            <div>
              <dt>Item</dt>
              <dd>{state.session.itemName}</dd>
            </div>
            <div>
              <dt>{closed ? 'Sold for' : 'Current bid'}</dt>
              <dd className="live-sync-bid" aria-live="polite">
                {formatUsd(state.session.currentBid)}
              </dd>
            </div>
            <div>
              <dt>{closed ? 'Winner' : 'Leader'}</dt>
              <dd>{state.session.lastBidderId ?? 'No bids yet'}</dd>
            </div>
          </dl>

          {closed ? (
            <p className="action-message">This auction has closed.</p>
          ) : (
            <button
              className="button button--primary"
              type="button"
              onClick={() => void placeBid()}
              disabled={placing}
            >
              {placing
                ? 'Placing bid…'
                : `Bid ${formatUsd(state.session.currentBid + BID_STEP)}`}
            </button>
          )}
        </>
      )}

      {bidMessage && (
        <p className="action-message" role="status">
          {bidMessage}
        </p>
      )}
    </section>
  )
}
