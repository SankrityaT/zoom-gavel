'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchResults, resultsUrl } from '@/lib/gavel/client-api'
import { BID_STEP, MAX_BID, formatUsd } from '@/lib/gavel/demo'
import { outcomeLabel } from '@/lib/gavel/results'
import type { RoundResult as RoundRecord, SessionState } from '@/lib/gavel/types'
import { useAuctionSession, type AuctionSessionHook } from './useAuctionSession'
import './panel.css'

type Props = {
  sessionKey: string
  sessionLabel: string
  bidderName: string
  /** Inside the Zoom client: push arrives over our own SSE stream. */
  inZoom: boolean
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
const BUY_NOW_CONFIRM_MS = 4000
// A double-click or touch bounce must not count as the confirming tap.
const BUY_NOW_ARM_MS = 500

const TRANSPORT_LABELS = {
  realtime: 'live',
  stream: 'live stream',
  polling: '1s polling',
} as const

export default function AuctionPanel({
  sessionKey,
  sessionLabel,
  bidderName,
  inZoom,
  roleHint,
}: Props) {
  const auction = useAuctionSession(sessionKey, bidderName, inZoom)
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

  const transportLabel = auction.transport
    ? `${sessionLabel} · ${TRANSPORT_LABELS[auction.transport]}`
    : sessionLabel

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

      <Leaderboard state={state} selfKey={auction.selfKey} />

      {/* Keyed by round so an armed Buy Now or a typed amount never carries
          into the next lot. */}
      {isOpen && <BidRow key={session.roundNo} state={state} auction={auction} />}
      {session.status === 'closed' && <ClosedState state={state} />}

      {showHostControls && <HostControls state={state} auction={auction} />}
      {showHostControls && <Results state={state} sessionKey={sessionKey} />}

      <ShareLink sessionKey={sessionKey} />
    </>
  )
}

function LotHeader({ state }: { state: SessionState }) {
  const { session, viewer, leaderboard } = state
  const bidCount = leaderboard.reduce((sum, entry) => sum + entry.bids, 0)
  return (
    <div className="panel-lot-row">
      <div className="panel-lot">
        <span className="panel-lot-name">{session.itemName}</span>
        <span className="panel-lot-meta">
          Round {session.roundNo || '–'} · {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
        </span>
      </div>
      <div className="panel-badges">
        {session.reservePrice !== null &&
          (session.reserveMet ? (
            <span className="panel-badge panel-badge--met">Reserve met</span>
          ) : (
            <span className="panel-badge">Reserve {formatUsd(session.reservePrice)}</span>
          ))}
        {session.buyNowPrice !== null && (
          <span className="panel-badge">Buy Now {formatUsd(session.buyNowPrice)}</span>
        )}
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

// One row per bidder, best bid first. Everyone sees the ranking; an amount
// shows only where the server (or this browser's own bid) supplied one.
function Leaderboard({ state, selfKey }: { state: SessionState; selfKey: string | null }) {
  const { session, leaderboard } = state
  return (
    <ol className="panel-ladder" aria-label="Leaderboard">
      {leaderboard.map((entry) => {
        const isSelf = selfKey !== null && entry.bidderKey === selfKey
        const classes = ['panel-rung']
        if (entry.rank === 1) classes.push('panel-rung--leader')
        if (isSelf) classes.push('panel-rung--self')
        return (
          <li key={entry.bidderKey} className={classes.join(' ')}>
            <span className="panel-rung-dot" aria-hidden="true" />
            <span className="panel-rung-rank">{entry.rank}</span>
            <span className="panel-rung-name">
              {labelFor(entry.name, entry.bidderKey, selfKey)}
              {!entry.verified && <span className="panel-rung-tag"> · unverified</span>}
            </span>
            {entry.amount !== null ? (
              <span className="panel-rung-amount">{formatUsd(entry.amount)}</span>
            ) : (
              <span className="panel-rung-private">Private</span>
            )}
          </li>
        )
      })}
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

  // A bid at or above the Buy Now price buys the lot, so ordinary bids stop
  // one short of it and the Buy Now button is the only way to that price.
  // Near the ceiling the quick bid shrinks to whatever room is left rather
  // than leaving a gap where nothing can be bid.
  const buyNow = session.buyNowPrice
  const bidCeiling = buyNow === null ? MAX_BID : buyNow - 1
  const minBid = session.leader === null ? session.currentBid : session.currentBid + 1
  const stepBid = session.leader === null ? session.currentBid : session.currentBid + BID_STEP
  const nextBid = Math.max(minBid, Math.min(stepBid, bidCeiling))
  const [confirmingBuy, setConfirmingBuy] = useState(false)
  const armedAt = useRef(0)
  useEffect(() => {
    if (!confirmingBuy) return
    const id = setTimeout(() => setConfirmingBuy(false), BUY_NOW_CONFIRM_MS)
    return () => clearTimeout(id)
  }, [confirmingBuy])
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
              : result.reason === 'rate_limited'
                ? 'Too many bids at once. Try again in a moment.'
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
  const customValid = Number.isInteger(customValue) && customValue >= minBid && customValue <= bidCeiling

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
        {nextBid <= bidCeiling ? (
          <button
            className="panel-bid-button"
            type="button"
            disabled={placing}
            onClick={() => void bid(nextBid)}
          >
            {placing ? 'Placing…' : `Bid ${formatUsd(nextBid)}`}
          </button>
        ) : (
          <span className="panel-bid-capped">Next bid reaches Buy Now</span>
        )}
        {nextBid + BID_STEP <= bidCeiling && (
          <button
            className="panel-secondary-button"
            type="button"
            disabled={placing}
            onClick={() => void bid(nextBid + BID_STEP)}
          >
            +{formatUsd(BID_STEP)}
          </button>
        )}
        {nextBid <= bidCeiling && (
          <button
            className="panel-secondary-button"
            type="button"
            onClick={() => setShowCustom((v) => !v)}
          >
            Custom
          </button>
        )}
      </div>

      {buyNow !== null && (
        <button
          className={confirmingBuy ? 'panel-buy-now panel-buy-now--confirm' : 'panel-buy-now'}
          type="button"
          disabled={placing}
          onClick={() => {
            if (!confirmingBuy) {
              armedAt.current = Date.now()
              setConfirmingBuy(true)
              return
            }
            if (Date.now() - armedAt.current < BUY_NOW_ARM_MS) return
            setConfirmingBuy(false)
            void bid(buyNow)
          }}
        >
          {confirmingBuy
            ? `Tap again to buy for ${formatUsd(buyNow)}`
            : `Buy now for ${formatUsd(buyNow)}`}
        </button>
      )}

      {showCustom && minBid <= bidCeiling && (
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
            min={minBid}
            max={bidCeiling}
            step={1}
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            placeholder={`${minBid} or more`}
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
          {session.boughtNow && <span className="panel-badge">Buy Now</span>}
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
  const [buyNow, setBuyNow] = useState(session.buyNowPrice === null ? '' : String(session.buyNowPrice))
  const [seconds, setSeconds] = useState('60')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const isOpen = session.status === 'open'
  const opening = Number.parseInt(openingBid, 10)
  const reserveValue = reserve.trim() === '' ? null : Number.parseInt(reserve, 10)
  const secs = Number.parseInt(seconds, 10)
  const buyNowValue = buyNow.trim() === '' ? null : Number.parseInt(buyNow, 10)
  const buyNowValid =
    buyNowValue === null ||
    (Number.isInteger(buyNowValue) &&
      buyNowValue > opening &&
      buyNowValue <= MAX_BID &&
      (reserveValue === null || buyNowValue >= reserveValue))
  const valid =
    buyNowValid &&
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
        buyNowPrice: buyNowValue,
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
              ? session.hostVerified
                ? 'You are the host, verified by Zoom'
                : 'You are the host'
              : session.hostVerified
                ? 'Only the meeting host can run rounds'
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
              Buy Now (optional)
              <input type="number" inputMode="numeric" min={1} max={MAX_BID} value={buyNow} onChange={(e) => setBuyNow(e.target.value)} placeholder="none" />
            </label>
            <label>
              Round length (s)
              <input type="number" inputMode="numeric" min={5} max={3600} value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </label>
          </div>
          {!buyNowValid && (
            <p className="panel-host-hint">Buy Now must be above the opening bid and not below the reserve.</p>
          )}
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

// Finished rounds for whoever runs the auction, with a CSV for collecting
// payment outside the app. The server refuses this to non-hosts on meeting
// sessions, in which case nothing renders.
function Results({ state, sessionKey }: { state: SessionState; sessionKey: string }) {
  const { session } = state
  const [rounds, setRounds] = useState<RoundRecord[] | null>(null)

  useEffect(() => {
    let active = true
    fetchResults(sessionKey)
      .then((next) => {
        if (active) setRounds(next)
      })
      .catch(() => {
        // Transient; the next round change refetches.
      })
    return () => {
      active = false
    }
  }, [sessionKey, session.status, session.roundNo])

  if (!rounds || rounds.length === 0) return null
  const sold = rounds.filter((round) => round.outcome === 'sold')
  const total = sold.reduce((sum, round) => sum + round.finalBid, 0)

  return (
    <div className="panel-results">
      <div className="section-heading">
        <p className="context-label">RESULTS</p>
        <span>
          {sold.length} of {rounds.length} sold · {formatUsd(total)}
        </span>
      </div>
      <ol className="panel-results-list">
        {rounds.map((round) => (
          <li key={round.roundNo}>
            <span className="panel-results-round">{round.roundNo}</span>
            <span className="panel-results-item">
              <strong>{round.itemName}</strong>
              <span>
                {round.outcome === 'sold' && round.winner
                  ? `${outcomeLabel(round)} to ${round.winner.name} #${round.winner.bidderKey.slice(-4)}`
                  : outcomeLabel(round)}
              </span>
            </span>
            <span className="panel-results-price">
              {round.outcome === 'sold' ? formatUsd(round.finalBid) : '–'}
            </span>
          </li>
        ))}
      </ol>
      <a className="button button--secondary panel-results-download" href={resultsUrl(sessionKey, 'csv')} download="gavel-results.csv">
        Download results (CSV)
      </a>
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
