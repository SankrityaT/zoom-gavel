'use client'

import { useEffect, useRef, useState } from 'react'
import { BID_STEP, MAX_BID, formatUsd } from '@/lib/gavel/demo'
import type { SessionState } from '@/lib/gavel/types'
import { useAuctionSession, type AuctionSessionHook } from './useAuctionSession'
import './panel.css'

type Props = {
  sessionKey: string
  sessionLabel: string
  bidderName: string
  forcePolling: boolean
  /** Client-side role from the Zoom SDK. A hint for showing controls; the server decides. */
  roleHint: string | null
}

const RING_LENGTH = 2 * Math.PI * 16

// Names are client-chosen even for verified bidders, so every name carries
// a short server-derived key suffix: two "Alice"s are visibly different.
function labelFor(name: string, bidderKey: string, selfKey: string | null) {
  if (selfKey !== null && bidderKey === selfKey) return 'You'
  return `${name} #${bidderKey.slice(-4)}`
}
const EXTENSION_TOAST_MS = 2500

export default function AuctionPanel({
  sessionKey,
  sessionLabel,
  bidderName,
  forcePolling,
  roleHint,
}: Props) {
  const auction = useAuctionSession(sessionKey, bidderName, forcePolling)
  const { sync } = auction

  if (sync.phase === 'unconfigured') {
    return (
      <section className="panel" aria-labelledby="panel-title">
        <p className="context-label" id="panel-title">LIVE AUCTION</p>
        <p>
          Backend not configured: set NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.
        </p>
      </section>
    )
  }

  const transportLabel = forcePolling ? `${sessionLabel} · 1s polling` : sessionLabel

  return (
    <section className="panel" aria-labelledby="panel-title">
      <div className="section-heading">
        <p className="context-label" id="panel-title">LIVE AUCTION</p>
        <span>{transportLabel}</span>
      </div>

      {sync.phase === 'connecting' && <p>Connecting to session…</p>}
      {sync.phase === 'error' && <p role="alert">Sync error: {sync.message}</p>}

      {sync.phase === 'live' && (
        <LivePanel state={sync.state} auction={auction} roleHint={roleHint} sessionKey={sessionKey} />
      )}
    </section>
  )
}

function LivePanel({
  state,
  auction,
  roleHint,
  sessionKey,
}: {
  state: SessionState
  auction: AuctionSessionHook
  roleHint: string | null
  sessionKey: string
}) {
  const { session, viewer } = state
  const isOpen = session.status === 'open'
  const youLead = auction.selfKey !== null && session.leader?.bidderKey === auction.selfKey
  const showHostControls =
    viewer.canControl || (!session.sandbox && (roleHint === 'host' || roleHint === 'coHost'))

  return (
    <>
      <LotHeader state={state} />

      <div className="panel-price-block">
        <span key={session.currentBid} className="panel-price">
          {formatUsd(session.currentBid)}
        </span>
        <span className={`panel-winner${session.status === 'closed' ? ' panel-winner--closed' : ''}`}>
          {session.status === 'idle'
            ? 'Waiting for the host to start a round'
            : session.leader === null
              ? `Opening bid ${formatUsd(session.openingBid)}, no paddles yet`
              : session.status === 'closed'
                ? youLead
                  ? 'You won the lot'
                  : `${labelFor(session.leader.name, session.leader.bidderKey, auction.selfKey)} won the lot`
                : youLead
                  ? 'You are winning'
                  : `${labelFor(session.leader.name, session.leader.bidderKey, auction.selfKey)} is winning`}
        </span>
      </div>

      <BidLadder state={state} selfKey={auction.selfKey} />

      {isOpen && <BidRow state={state} auction={auction} />}
      {session.status === 'closed' && <ClosedState state={state} />}

      {showHostControls && <HostControls state={state} auction={auction} />}

      <ShareLink sessionKey={sessionKey} />
    </>
  )
}

function LotHeader({ state }: { state: SessionState }) {
  const { session, viewer, bids } = state
  return (
    <div className="panel-lot-row">
      <div className="panel-lot">
        <span className="panel-lot-name">{session.itemName}</span>
        <span className="panel-lot-meta">
          Round {session.roundNo || '–'} · {bids.length} {bids.length === 1 ? 'bid' : 'bids'}
        </span>
      </div>
      <div className="panel-badges">
        {session.reservePrice !== null &&
          (session.reserveMet ? (
            <span className="panel-badge panel-badge--met">Reserve met</span>
          ) : (
            <span className="panel-badge">Reserve {formatUsd(session.reservePrice)}</span>
          ))}
        {session.sandbox ? (
          <span className="panel-badge">Sandbox</span>
        ) : viewer.verified ? (
          <span className="panel-badge panel-badge--verified">Verified via Zoom</span>
        ) : (
          <span className="panel-badge">Unverified</span>
        )}
      </div>
    </div>
  )
}

function BidLadder({ state, selfKey }: { state: SessionState; selfKey: string | null }) {
  const { session, bids } = state
  return (
    <ol className="panel-ladder">
      {bids.map((bid, index) => (
        <li key={bid.id} className={index === 0 ? 'panel-rung panel-rung--leader' : 'panel-rung'}>
          <span className="panel-rung-dot" aria-hidden="true" />
          <span className="panel-rung-name">
            {labelFor(bid.bidderName, bid.bidderKey, selfKey)}
            {!bid.verified && <span className="panel-rung-tag"> · unverified</span>}
          </span>
          <span className="panel-rung-amount">{formatUsd(bid.amount)}</span>
        </li>
      ))}
      {session.status !== 'idle' && (
        <li className="panel-rung panel-rung--opening">
          <span className="panel-rung-dot" aria-hidden="true" />
          <span className="panel-rung-name">Opening bid</span>
          <span className="panel-rung-amount">{formatUsd(session.openingBid)}</span>
        </li>
      )}
    </ol>
  )
}

// Ticking clock as state, so render stays pure: the interval samples the
// server-synced time and the deadline ratio, and components just read them.
type Clock = { nowMs: number; wallMs: number; ratio: number }

function useRoundClock(auction: AuctionSessionHook, endsAt: string | null, roundNo: number): Clock {
  const [clock, setClock] = useState<Clock>(() => ({ nowMs: 0, wallMs: 0, ratio: 0 }))
  const maxRemaining = useRef(0)

  useEffect(() => {
    maxRemaining.current = 0
    const endsAtMs = endsAt ? new Date(endsAt).getTime() : null

    function sample() {
      const nowMs = auction.now()
      const remaining = endsAtMs === null ? 0 : Math.max(0, endsAtMs - nowMs)
      if (remaining > maxRemaining.current) maxRemaining.current = remaining
      const ratio = maxRemaining.current > 0 ? remaining / maxRemaining.current : 0
      setClock({ nowMs, wallMs: Date.now(), ratio })
    }

    sample()
    const id = setInterval(sample, 250)
    return () => clearInterval(id)
  }, [auction, endsAt, roundNo])

  return clock
}

function BidRow({ state, auction }: { state: SessionState; auction: AuctionSessionHook }) {
  const { session } = state
  const { nowMs, wallMs, ratio } = useRoundClock(auction, session.endsAt, session.roundNo)
  const endsAtMs = session.endsAt ? new Date(session.endsAt).getTime() : nowMs
  const remainingMs = nowMs === 0 ? 0 : Math.max(0, endsAtMs - nowMs)
  const remainingSec = Math.ceil(remainingMs / 1000)
  const low = remainingSec <= session.extendWindowSeconds

  const [placing, setPlacing] = useState(false)
  const [message, setMessage] = useState('')
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  const zeroFired = useRef(false)
  useEffect(() => {
    if (nowMs === 0) return
    if (remainingMs > 0) {
      zeroFired.current = false
      return
    }
    if (!zeroFired.current) {
      zeroFired.current = true
      void auction.refresh()
    }
  }, [remainingMs, nowMs, auction])

  const nextBid = session.leader === null ? session.currentBid : session.currentBid + BID_STEP
  const showToast = auction.extendedAt !== null && wallMs - auction.extendedAt < EXTENSION_TOAST_MS

  async function bid(amount: number) {
    if (placing) return
    setPlacing(true)
    setMessage('')
    try {
      const result = await auction.placeBid(amount)
      if (result.accepted) {
        setMessage(result.extended ? `Bid ${formatUsd(amount)} accepted, clock extended.` : `Bid ${formatUsd(amount)} accepted.`)
        setShowCustom(false)
        setCustom('')
      } else {
        setMessage(
          result.reason === 'too_low'
            ? `Outbid. Minimum is now ${formatUsd(result.minAmount ?? nextBid)}.`
            : result.reason === 'expired' || result.reason === 'not_open'
              ? 'The round closed before your bid arrived.'
              : `Bid rejected (${result.reason}).`,
        )
      }
    } catch (error) {
      setMessage(`Bid did not reach the server: ${error instanceof Error ? error.message : 'network error'}`)
    } finally {
      setPlacing(false)
    }
  }

  const customValue = Number.parseInt(custom, 10)
  const customValid = Number.isInteger(customValue) && customValue >= nextBid && customValue <= MAX_BID

  return (
    <div className="panel-action-block">
      <div className="panel-action">
        <span className={low ? 'panel-ring panel-ring--low' : 'panel-ring'} aria-label={`${remainingSec} seconds left`}>
          <svg viewBox="0 0 40 40" width="46" height="46" aria-hidden="true">
            <circle className="panel-ring-track" cx="20" cy="20" r="16" />
            <circle
              className="panel-ring-fill"
              cx="20"
              cy="20"
              r="16"
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - ratio)}
              transform="rotate(-90 20 20)"
            />
          </svg>
          <em>{remainingSec}</em>
        </span>
        <button
          className="panel-bid-button"
          type="button"
          disabled={placing}
          onClick={() => void bid(nextBid)}
        >
          {placing ? 'Placing…' : `Bid ${formatUsd(nextBid)}`}
        </button>
        <button
          className="panel-secondary-button"
          type="button"
          disabled={placing}
          onClick={() => void bid(nextBid + BID_STEP)}
        >
          +{formatUsd(BID_STEP)}
        </button>
        <button
          className="panel-secondary-button"
          type="button"
          onClick={() => setShowCustom((v) => !v)}
        >
          Custom
        </button>
      </div>

      {showCustom && (
        <form
          className="panel-custom"
          onSubmit={(event) => {
            event.preventDefault()
            if (customValid) void bid(customValue)
          }}
        >
          <input
            type="number"
            inputMode="numeric"
            min={nextBid}
            max={MAX_BID}
            step={1}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder={`${nextBid} or more`}
            aria-label="Custom bid amount"
          />
          <button className="panel-secondary-button" type="submit" disabled={!customValid || placing}>
            Bid
          </button>
        </form>
      )}

      {showToast && (
        <p className="panel-extend" role="status">
          Late bid, clock extended +{session.extendBySeconds}s
        </p>
      )}
      {message && (
        <p className="action-message" role="status">
          {message}
        </p>
      )}
    </div>
  )
}

function ClosedState({ state }: { state: SessionState }) {
  const { session } = state
  const sold = session.leader !== null && session.reserveMet
  return (
    <div className="panel-closed">
      {sold ? (
        <>
          <span className="panel-sold-word">Sold</span>
          <span className="panel-sold-price">{formatUsd(session.currentBid)}</span>
        </>
      ) : (
        <span className="panel-not-sold">
          {session.leader === null ? 'Not sold: no bids' : 'Not sold: reserve not met'}
        </span>
      )}
    </div>
  )
}

function HostControls({ state, auction }: { state: SessionState; auction: AuctionSessionHook }) {
  const { session, viewer } = state
  const [itemName, setItemName] = useState(session.itemName)
  const [openingBid, setOpeningBid] = useState(String(session.openingBid || 100))
  const [reserve, setReserve] = useState(session.reservePrice === null ? '' : String(session.reservePrice))
  const [seconds, setSeconds] = useState('60')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const isOpen = session.status === 'open'
  const opening = Number.parseInt(openingBid, 10)
  const reserveValue = reserve.trim() === '' ? null : Number.parseInt(reserve, 10)
  const secs = Number.parseInt(seconds, 10)
  const valid =
    itemName.trim().length > 0 &&
    Number.isInteger(opening) && opening >= 0 && opening <= MAX_BID &&
    (reserveValue === null || (Number.isInteger(reserveValue) && reserveValue >= 0 && reserveValue <= MAX_BID)) &&
    Number.isInteger(secs) && secs >= 5 && secs <= 3600

  async function start() {
    if (!valid || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await auction.startRound({
        itemName: itemName.trim(),
        openingBid: opening,
        reservePrice: reserveValue,
        seconds: secs,
      })
      if (!result.ok) {
        setMessage(
          result.error ??
            (result.reason === 'round_open' ? 'A round is already open.' : `Could not start (${result.reason}).`),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function stop() {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await auction.stopRound()
      if (!result.ok) setMessage(result.error ?? `Could not stop (${result.reason}).`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel-host">
      <div className="section-heading">
        <p className="context-label">HOST CONTROLS</p>
        <span>
          {session.sandbox
            ? 'Sandbox: anyone can run the clock'
            : viewer.isHost
              ? 'You are the host'
              : session.hostClaimed
                ? 'Host claimed by someone else'
                : 'First to start claims host'}
        </span>
      </div>

      {isOpen ? (
        <button className="button button--secondary" type="button" disabled={busy} onClick={() => void stop()}>
          {busy ? 'Stopping…' : 'Stop round now'}
        </button>
      ) : (
        <form
          className="panel-host-form"
          onSubmit={(event) => {
            event.preventDefault()
            void start()
          }}
        >
          <label>
            Item
            <input value={itemName} onChange={(e) => setItemName(e.target.value)} maxLength={120} />
          </label>
          <div className="panel-host-grid">
            <label>
              Opening bid
              <input type="number" inputMode="numeric" min={0} max={MAX_BID} value={openingBid} onChange={(e) => setOpeningBid(e.target.value)} />
            </label>
            <label>
              Reserve (optional)
              <input type="number" inputMode="numeric" min={0} max={MAX_BID} value={reserve} onChange={(e) => setReserve(e.target.value)} placeholder="none" />
            </label>
            <label>
              Round length (s)
              <input type="number" inputMode="numeric" min={5} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </label>
          </div>
          <button className="button button--primary" type="submit" disabled={!valid || busy}>
            {busy ? 'Starting…' : session.status === 'closed' ? 'Start next round' : 'Start round'}
          </button>
        </form>
      )}

      {message && (
        <p className="action-message" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

function ShareLink({ sessionKey }: { sessionKey: string }) {
  const [copied, setCopied] = useState(false)
  const [note, setNote] = useState('')
  const shareUrl =
    typeof window === 'undefined'
      ? ''
      : `${window.location.origin}/zoom-test?session=${encodeURIComponent(sessionKey)}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setNote('Clipboard blocked here. Tap the link field to select it.')
    }
  }

  return (
    <div className="live-sync-share">
      <div className="live-sync-share-row">
        <span className="live-sync-share-label">Bid from any browser</span>
        <button className="button button--secondary" type="button" onClick={() => void copy()}>
          {copied ? 'Link copied' : 'Copy join link'}
        </button>
      </div>
      <input
        className="live-sync-share-input"
        type="text"
        readOnly
        value={shareUrl}
        aria-label="Join link for this session"
        onFocus={(event) => event.currentTarget.select()}
        onClick={(event) => event.currentTarget.select()}
      />
      {note && <p className="action-message">{note}</p>}
    </div>
  )
}
