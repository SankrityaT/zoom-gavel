'use client'

import { useCallback, useEffect, useState } from 'react'
import { getBrowserClient, supabaseConfigured } from '@/lib/gavel/browser'
import { toSession, type AuctionSession, type AuctionSessionRow } from '@/lib/gavel/types'

const BID_STEP = 10

type Props = {
  sessionId: string
  bidderId: string
  /** True when the id came from a live Collaborate session rather than the browser fallback. */
  fromCollaborate: boolean
}

type SyncState =
  | { phase: 'unconfigured' }
  | { phase: 'connecting' }
  | { phase: 'live'; session: AuctionSession }
  | { phase: 'error'; message: string }

export default function LiveBidSync({ sessionId, bidderId, fromCollaborate }: Props) {
  const [state, setState] = useState<SyncState>(
    supabaseConfigured() ? { phase: 'connecting' } : { phase: 'unconfigured' },
  )
  const [bidMessage, setBidMessage] = useState('')

  useEffect(() => {
    if (!supabaseConfigured()) return
    let active = true

    async function start() {
      try {
        const initRes = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ init: true, itemName: 'Lot 001 · Glass horse', openingBid: 950 }),
        })
        if (!initRes.ok) throw new Error(`init failed (${initRes.status})`)
        const session = (await initRes.json()) as AuctionSession
        if (active) setState({ phase: 'live', session })
      } catch (error) {
        if (active) {
          setState({
            phase: 'error',
            message: error instanceof Error ? error.message : 'could not reach backend',
          })
        }
      }
    }

    void start()

    const channel = getBrowserClient()
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'auction_sessions',
          filter: `uuid=eq.${sessionId}`,
        },
        (payload) => {
          if (!active) return
          const row = payload.new as AuctionSessionRow
          if (row?.uuid) setState({ phase: 'live', session: toSession(row) })
        },
      )
      .subscribe()

    return () => {
      active = false
      void getBrowserClient().removeChannel(channel)
    }
  }, [sessionId])

  const placeBid = useCallback(async () => {
    if (state.phase !== 'live') return
    setBidMessage('Placing bid...')
    const amount = state.session.currentBid + BID_STEP
    const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount, bidderId }),
    })
    if (res.status === 409) {
      setBidMessage('Outbid: someone got there first. Try again.')
      return
    }
    if (!res.ok) {
      setBidMessage(`Bid failed (${res.status})`)
      return
    }
    setBidMessage(`Bid $${amount} accepted.`)
  }, [state, sessionId, bidderId])

  if (state.phase === 'unconfigured') {
    return (
      <section className="live-sync" aria-labelledby="live-sync-title">
        <p className="context-label" id="live-sync-title">
          LIVE BID SYNC
        </p>
        <p>Backend not configured yet: missing Supabase environment variables.</p>
      </section>
    )
  }

  return (
    <section className="live-sync" aria-labelledby="live-sync-title">
      <div className="section-heading">
        <p className="context-label" id="live-sync-title">
          LIVE BID SYNC
        </p>
        <span>{fromCollaborate ? 'Collaborate session' : 'Browser test session'}</span>
      </div>

      {state.phase === 'connecting' && <p>Connecting to session…</p>}
      {state.phase === 'error' && <p role="alert">Sync error: {state.message}</p>}

      {state.phase === 'live' && (
        <>
          <dl>
            <div>
              <dt>Session</dt>
              <dd className="live-sync-id">{sessionId}</dd>
            </div>
            <div>
              <dt>Item</dt>
              <dd>{state.session.itemName}</dd>
            </div>
            <div>
              <dt>Current bid</dt>
              <dd className="live-sync-bid" aria-live="polite">
                ${state.session.currentBid.toLocaleString('en-US')}
              </dd>
            </div>
            <div>
              <dt>Leader</dt>
              <dd>{state.session.lastBidderId ?? 'No bids yet'}</dd>
            </div>
          </dl>

          <button
            className="button button--primary"
            type="button"
            onClick={() => void placeBid()}
          >
            Bid ${(state.session.currentBid + BID_STEP).toLocaleString('en-US')}
          </button>
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
