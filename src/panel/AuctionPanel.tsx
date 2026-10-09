'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Image from 'next/image'
import {
  fetchQueue,
  fetchResults,
  queueAdd,
  queueRemove,
  queueStartNext,
  resultsUrl,
  type QueueLot,
} from '@/lib/gavel/client-api'
import { BID_STEP, MAX_BID, formatUsd } from '@/lib/gavel/demo'
import { outcomeLabel } from '@/lib/gavel/results'
import type { LeaderEntry, QueueItem, RoundResult as RoundRecord, SessionState } from '@/lib/gavel/types'
import logo from '@/marketing/assets/logo.png'
import { playCue, useCues, useMuted, type Alert } from './cues'
import { RollingNumber, useFlip } from './motion'
import { useAuctionSession, type AuctionSessionHook } from './useAuctionSession'
import './panel.css'

type Props = {
  sessionKey: string
  bidderName: string
  /** Inside the Zoom client: push arrives over our own SSE stream. */
  inZoom: boolean
  /** Client-side role from the Zoom SDK. A hint for copy only; the server decides. */
  roleHint: string | null
  /** Opens the app for everyone in the meeting (Zoom Collaborate). In-meeting hosts only. */
  onInviteMeeting?: () => Promise<void>
}

const EXTENSION_TOAST_MS = 2500
const BUY_NOW_CONFIRM_MS = 4000
// A double-click or touch bounce must not count as the confirming tap.
const BUY_NOW_ARM_MS = 500
const ROUND_LENGTHS = [
  { seconds: 30, label: '30 sec' },
  { seconds: 60, label: '1 min' },
  { seconds: 120, label: '2 min' },
  { seconds: 300, label: '5 min' },
]
// The last seconds of a round each get a tick.
const TICK_FROM_SEC = 5
const QUEUE_READ_RETRIES = 3
const AVATAR_TINTS = ['coral', 'sage', 'sand', 'sky', 'plum']

// Names are client-chosen even for verified bidders, so every name other
// than the viewer's own carries a short server-derived key suffix: two
// people called Alice are visibly different.
// The stored name may carry a " · id" tail that keeps unverified bidders
// with the same screen name apart; it is not for display.
function displayName(name: string) {
  return name.split(' · ')[0] || name
}

function nameParts(name: string, bidderKey: string, selfKey: string | null) {
  if (selfKey !== null && bidderKey === selfKey) return { name: 'You', suffix: null, self: true }
  return { name: displayName(name), suffix: `#${bidderKey.slice(-4)}`, self: false }
}

function tintFor(bidderKey: string) {
  let sum = 0
  for (const ch of bidderKey) sum += ch.charCodeAt(0)
  return AVATAR_TINTS[sum % AVATAR_TINTS.length]
}

function clockText(remainingSec: number) {
  const minutes = Math.floor(remainingSec / 60)
  return `${minutes}:${String(remainingSec % 60).padStart(2, '0')}`
}

export default function AuctionPanel({ sessionKey, bidderName, inZoom, roleHint, onInviteMeeting }: Props) {
  const auction = useAuctionSession(sessionKey, bidderName, inZoom)
  const { sync } = auction
  const { alert, dismiss } = useCues(sync.phase === 'live' ? sync.state : null, auction.selfKey)

  return (
    <section className="gv" aria-label="Live auction">
      <Header auction={auction} />
      {alert && <Toast key={alert.id} alert={alert} onDismiss={dismiss} />}
      {sync.phase === 'unconfigured' && (
        <p className="gv-note">The auction service is not set up yet.</p>
      )}
      {sync.phase === 'connecting' && <p className="gv-note">Connecting…</p>}
      {sync.phase === 'error' && (
        <p className="gv-note" role="alert">
          Could not reach the auction. {sync.message}
        </p>
      )}
      {sync.phase === 'live' && (
        <LivePanel
          state={sync.state}
          auction={auction}
          roleHint={roleHint}
          sessionKey={sessionKey}
          onInviteMeeting={onInviteMeeting}
        />
      )}
    </section>
  )
}

function Header({ auction }: { auction: AuctionSessionHook }) {
  const state = auction.sync.phase === 'live' ? auction.sync.state : null
  const [muted, toggleMuted] = useMuted()
  let status = ''
  let tone = ''
  if (state) {
    const { session, viewer, leaderboard } = state
    if (session.status === 'open') {
      status = leaderboard.length === 0 ? 'Bidding is open' : `${leaderboard.length} bidding`
      tone = 'live'
    } else if (viewer.isHost || (session.sandbox && viewer.canControl)) {
      status = "You're hosting"
      tone = 'host'
    } else if (session.status === 'closed') {
      status = 'Round over'
    }
  }
  return (
    <header className="gv-head">
      <span className="gv-brand">
        <Image src={logo} alt="" width={28} height={28} />
        Gavel
      </span>
      <span className="gv-head-side">
        {status && (
          <span className={tone ? `gv-status gv-status--${tone}` : 'gv-status'}>
            {tone === 'live' && <i aria-hidden="true" />}
            {status}
          </span>
        )}
        <button
          className="gv-mute"
          type="button"
          aria-pressed={muted}
          aria-label={muted ? 'Turn sounds on' : 'Mute sounds'}
          title={muted ? 'Turn sounds on' : 'Mute sounds'}
          onClick={toggleMuted}
        >
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
            <path d="M3 8h3l4-3.5v11L6 12H3z" fill="currentColor" />
            {muted ? (
              <path d="M13 7.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            ) : (
              <path
                d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            )}
          </svg>
        </button>
      </span>
    </header>
  )
}

// The alert for a moment that must not be missed. Tapping it puts it away.
function Toast({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  return (
    <div className="gv-toast-slot" role={alert.tone === 'outbid' ? 'alert' : 'status'}>
      <button className={`gv-toast gv-toast--${alert.tone}`} type="button" onClick={onDismiss}>
        <strong>{alert.title}</strong>
        {alert.detail && <span>{alert.detail}</span>}
      </button>
    </div>
  )
}

function LivePanel({
  state,
  auction,
  roleHint,
  sessionKey,
  onInviteMeeting,
}: {
  state: SessionState
  auction: AuctionSessionHook
  roleHint: string | null
  sessionKey: string
  onInviteMeeting?: () => Promise<void>
}) {
  const { session, viewer } = state
  const isOpen = session.status === 'open'
  const canHost = viewer.canControl
  // Zoom says this person is the host, but the server has not confirmed it.
  const hostUnconfirmed =
    !canHost && !session.sandbox && (roleHint === 'host' || roleHint === 'coHost') && !session.hostVerified

  return (
    <>
      {session.status === 'idle' ? (
        !canHost && <Waiting hostUnconfirmed={hostUnconfirmed} upNext={session.upNext} />
      ) : (
        <>
          <LotTag state={state} auction={auction} />
          <Bidders state={state} selfKey={auction.selfKey} />
        </>
      )}

      {/* Keyed by round so an armed Buy Now or a typed amount never carries
          into the next lot. */}
      {isOpen && <BidDock key={session.roundNo} state={state} auction={auction} />}
      {isOpen && canHost && <EndRound auction={auction} upNext={session.upNext} />}

      {session.status === 'closed' && !canHost && (
        <p className="gv-after">
          {session.leader !== null && session.reserveMet ? 'The host will be in touch about payment. ' : ''}
          {session.upNext === null ? (
            'The next lot starts when the host is ready.'
          ) : (
            <>
              Up next: <b>{session.upNext}</b>
            </>
          )}
        </p>
      )}

      {!isOpen && canHost && (
        <>
          <HostDesk key={session.roundNo} state={state} auction={auction} sessionKey={sessionKey} />
          <Invite sessionKey={sessionKey} onInviteMeeting={onInviteMeeting} />
        </>
      )}
      {canHost && <Receipt state={state} sessionKey={sessionKey} />}
    </>
  )
}

function Waiting({ hostUnconfirmed, upNext }: { hostUnconfirmed: boolean; upNext: string | null }) {
  return (
    <div className="gv-waiting">
      <p className="gv-waiting-title">Nothing on the block yet.</p>
      <p className="gv-waiting-body">
        {hostUnconfirmed
          ? 'Zoom has not confirmed you as the host. Close Gavel and open it again from Apps.'
          : 'The host starts each lot. Bidding opens here the moment they do.'}
      </p>
      {upNext !== null && !hostUnconfirmed && (
        <p className="gv-waiting-body">
          Up first: <b>{upNext}</b>
        </p>
      )}
    </div>
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

// The lot, drawn as a price tag: item, the price, who holds it, and the
// clock along the tear line.
function LotTag({ state, auction }: { state: SessionState; auction: AuctionSessionHook }) {
  const { session } = state
  const isOpen = session.status === 'open'
  const sold = session.status === 'closed' && session.leader !== null && session.reserveMet
  const youLead = auction.selfKey !== null && session.leader?.bidderKey === auction.selfKey

  let line: ReactNode
  let tone = ''
  if (session.leader === null) {
    line = isOpen ? 'No bids yet. The opening bid is yours to take.' : 'Not sold. Nobody bid.'
  } else if (isOpen) {
    tone = youLead ? 'good' : ''
    line = youLead ? (
      <b>You&apos;re winning</b>
    ) : (
      <>
        <b>{displayName(session.leader.name)}</b> is winning
      </>
    )
  } else if (sold) {
    tone = youLead ? 'good' : 'done'
    line = (
      <>
        <b>{youLead ? 'You won it' : `${displayName(session.leader.name)} won it`}</b>
        {session.boughtNow ? ' with Buy Now' : ''}
      </>
    )
  } else {
    line = 'Not sold. The reserve was not met.'
  }

  return (
    <div className="gv-tagwrap">
      <svg className="gv-string" viewBox="0 0 74 50" fill="none" aria-hidden="true">
        <path
          d="M17 46C10 26 26 6 46 10c15 3 15 22 2 24-9 1-13-10-4-14"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <div className="gv-tagshadow">
      <div className={isOpen ? 'gv-tag' : 'gv-tag gv-tag--closed'}>
        <span className="gv-hole" aria-hidden="true" />
        <div className="gv-lotline">
          <span>Lot {session.roundNo}</span>
          {session.reservePrice !== null &&
            !sold &&
            (session.reserveMet ? (
              <span className="gv-chip gv-chip--met">Reserve met</span>
            ) : (
              <span className="gv-chip">Reserve {formatUsd(session.reservePrice)}</span>
            ))}
        </div>
        <h2 className="gv-item">{session.itemName}</h2>
        <p className="gv-price">
          <sup>$</sup>
          <RollingNumber text={session.currentBid.toLocaleString('en-US')} />
        </p>
        <p className={tone ? `gv-who gv-who--${tone}` : 'gv-who'}>{line}</p>
        {isOpen && <TagClock state={state} auction={auction} />}
      </div>
      </div>
      {sold && <span className="gv-stamp">Sold</span>}
    </div>
  )
}

function TagClock({ state, auction }: { state: SessionState; auction: AuctionSessionHook }) {
  const { session } = state
  const { nowMs, wallMs, ratio } = useRoundClock(auction, session.endsAt, session.roundNo)
  const endsAtMs = session.endsAt ? new Date(session.endsAt).getTime() : nowMs
  const remainingMs = nowMs === 0 ? 0 : Math.max(0, endsAtMs - nowMs)
  const remainingSec = Math.ceil(remainingMs / 1000)
  const low = nowMs !== 0 && remainingSec <= session.extendWindowSeconds
  const extended = auction.extendedAt !== null && wallMs - auction.extendedAt < EXTENSION_TOAST_MS

  // The server closes the round; ask it as soon as the clock runs out.
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

  // A double beep when the clock enters its last stretch, then a tick for
  // each of the final seconds. Nothing sounds for the second the panel
  // opens on, or when an extension pushes the clock back up.
  const lastSec = useRef<number | null>(null)
  useEffect(() => {
    if (nowMs === 0) return
    const before = lastSec.current
    lastSec.current = remainingSec
    if (before === null || remainingSec >= before || remainingSec <= 0) return
    if (remainingSec <= TICK_FROM_SEC) playCue('tick')
    else if (before > session.extendWindowSeconds && remainingSec <= session.extendWindowSeconds) playCue('low')
  }, [remainingSec, nowMs, session.extendWindowSeconds])

  return (
    <div className={low ? 'gv-clock gv-clock--low' : 'gv-clock'} aria-label={`${remainingSec} seconds left`}>
      <span className="gv-clock-time">{nowMs === 0 ? '' : clockText(remainingSec)}</span>
      <span className="gv-clock-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="gv-clock-note">{extended ? `Extended ${session.extendBySeconds} sec` : 'left'}</span>
    </div>
  )
}

// One entry per bidder, best bid first. Everyone sees the ranking; an amount
// shows only where the server (or this browser's own bid) supplied one. The
// leader's row is a card; everyone else carries a rank badge. It is one list
// so a row can glide from one place to another when the order changes.
function Bidders({ state, selfKey }: { state: SessionState; selfKey: string | null }) {
  const { leaderboard, session } = state
  const closed = session.status === 'closed'
  const bidCount = leaderboard.reduce((sum, entry) => sum + entry.bids, 0)
  const anyHidden = leaderboard.some((entry) => entry.amount === null)
  const listRef = useRef<HTMLOListElement>(null)
  useFlip(listRef, leaderboard.map((entry) => entry.bidderKey).join(','))

  return (
    <div className="gv-bidders">
      <div className="gv-sect">
        <h3>Bidders</h3>
        <span>
          {bidCount} {bidCount === 1 ? 'bid' : 'bids'}
        </span>
      </div>
      {leaderboard.length === 0 ? (
        <p className="gv-empty">Nobody has bid yet.</p>
      ) : (
        <>
          <ol className="gv-rows" ref={listRef}>
            {leaderboard.map((entry) => (
              <BidderRow
                key={entry.bidderKey}
                entry={entry}
                selfKey={selfKey}
                closed={closed}
                sold={closed && session.reserveMet}
                leading={session.currentBid}
              />
            ))}
          </ol>
          {anyHidden && <p className="gv-legend">Only you and the host can see your amount.</p>}
        </>
      )}
    </div>
  )
}

function bidsText(count: number) {
  return `${count} ${count === 1 ? 'bid' : 'bids'}`
}

function BidderRow({
  entry,
  selfKey,
  closed,
  sold,
  leading,
}: {
  entry: LeaderEntry
  selfKey: string | null
  closed: boolean
  sold: boolean
  leading: number
}) {
  const { name, suffix, self } = nameParts(entry.name, entry.bidderKey, selfKey)
  const lead = entry.rank === 1
  const behind = !lead && self && entry.amount !== null && !closed ? leading - entry.amount : null
  const guest = !entry.verified && !self && name !== 'Guest'

  const detail = [
    lead ? (closed ? (sold ? 'Winner' : 'Highest bid') : 'Leading') : null,
    behind !== null && behind > 0 ? `${formatUsd(behind)} behind` : null,
    bidsText(entry.bids),
    guest ? 'Guest' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const classes = ['gv-row']
  if (lead) classes.push('gv-row--lead')
  if (self) classes.push('gv-row--self')

  return (
    <li className={classes.join(' ')} data-key={entry.bidderKey}>
      <span className={self ? 'gv-avatar gv-avatar--self' : `gv-avatar gv-avatar--${tintFor(entry.bidderKey)}`} aria-hidden="true">
        {name.charAt(0).toUpperCase()}
        {!lead && <i>{entry.rank}</i>}
      </span>
      <span className="gv-name">
        <strong>
          {name}
          {suffix && <small>{suffix}</small>}
        </strong>
        <span>{detail}</span>
      </span>
      {entry.amount !== null ? (
        <span className="gv-amount">
          <RollingNumber text={formatUsd(entry.amount)} />
        </span>
      ) : (
        <span className="gv-lock" role="img" aria-label="Amount hidden">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor" />
            <path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </span>
      )}
    </li>
  )
}

function BidDock({ state, auction }: { state: SessionState; auction: AuctionSessionHook }) {
  const { session } = state
  // A bid at or above the Buy Now price buys the lot, so ordinary bids stop
  // one short of it and the Buy Now control is the only way to that price.
  const buyNow = session.buyNowPrice
  const bidCeiling = buyNow === null ? MAX_BID : buyNow - 1
  const minBid = session.leader === null ? session.currentBid : session.currentBid + 1
  const stepBid = session.leader === null ? session.currentBid : session.currentBid + BID_STEP
  const suggested = Math.max(minBid, Math.min(stepBid, bidCeiling))
  const canBid = minBid <= bidCeiling

  // What the person has dialled in above the suggestion; cleared whenever
  // the price moves past it.
  const [dialled, setDialled] = useState<number | null>(null)
  const amount = dialled !== null && dialled >= minBid && dialled <= bidCeiling ? dialled : suggested
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [placing, setPlacing] = useState(false)
  const [message, setMessage] = useState('')
  const [confirmingBuy, setConfirmingBuy] = useState(false)
  const armedAt = useRef(0)

  // The max bid: the most this bidder will pay. The server bids for them.
  const youLead = auction.selfKey !== null && session.leader?.bidderKey === auction.selfKey
  const maxBid = auction.maxBid
  const maxFloor = Math.max(1, youLead ? session.currentBid : minBid)
  const [settingMax, setSettingMax] = useState(false)
  const [maxTyped, setMaxTyped] = useState('')
  const [savingMax, setSavingMax] = useState(false)
  const maxValue = Number.parseInt(maxTyped.replace(/[^0-9]/g, ''), 10)
  const maxValid = Number.isInteger(maxValue) && maxValue >= maxFloor && maxValue <= bidCeiling
  const maxPassed = maxBid !== null && !youLead && session.currentBid >= maxBid

  async function saveMax(value: number | null) {
    if (savingMax) return
    setSavingMax(true)
    setMessage('')
    try {
      const result = await auction.setMaxBid(value)
      if (result.ok) {
        setSettingMax(false)
        setMaxTyped('')
      } else {
        setMessage(
          result.reason === 'too_low'
            ? `Your max has to be at least ${formatUsd(result.minAmount ?? maxFloor)}.`
            : result.reason === 'over_buy_now'
              ? `Your max has to stay under the Buy Now price. The most you can set is ${formatUsd(result.maxAllowed ?? bidCeiling)}.`
              : result.reason === 'expired' || result.reason === 'not_open'
                ? 'The round closed before your max was set.'
                : result.reason === 'rate_limited'
                  ? 'Too many changes at once. Try again in a moment.'
                  : 'Your max was not saved. Try again.',
        )
      }
    } catch {
      setMessage('Your max did not reach the auction. Check your connection and try again.')
    } finally {
      setSavingMax(false)
    }
  }

  useEffect(() => {
    if (!confirmingBuy) return
    const id = setTimeout(() => setConfirmingBuy(false), BUY_NOW_CONFIRM_MS)
    return () => clearTimeout(id)
  }, [confirmingBuy])

  async function bid(value: number) {
    if (placing) return
    setPlacing(true)
    setMessage('')
    try {
      const result = await auction.placeBid(value)
      if (result.accepted) {
        setDialled(null)
        setTyping(false)
        setTyped('')
        // The bid landed and was answered at once, usually by a max bid.
        const after = result.state.session
        if (after.status === 'open' && auction.selfKey !== null && after.leader?.bidderKey !== auction.selfKey) {
          setMessage(`You were outbid straight away. The price is now ${formatUsd(after.currentBid)}.`)
        }
      } else {
        setMessage(
          result.reason === 'too_low'
            ? `Someone got there first. The lowest bid is now ${formatUsd(result.minAmount ?? suggested)}.`
            : result.reason === 'expired' || result.reason === 'not_open'
              ? 'The round closed before your bid arrived.'
              : result.reason === 'rate_limited'
                ? 'Too many bids at once. Try again in a moment.'
                : 'That bid was not accepted. Try again.',
        )
      }
    } catch {
      setMessage('Your bid did not reach the auction. Check your connection and try again.')
    } finally {
      setPlacing(false)
    }
  }

  const typedValue = Number.parseInt(typed.replace(/[^0-9]/g, ''), 10)
  const typedValid = Number.isInteger(typedValue) && typedValue >= minBid && typedValue <= bidCeiling

  return (
    <div className="gv-dock">
      {canBid ? (
        typing ? (
          <form
            className="gv-type"
            onSubmit={(event) => {
              event.preventDefault()
              if (typedValid) void bid(typedValue)
            }}
          >
            <label className="gv-type-field">
              <span>$</span>
              <input
                inputMode="numeric"
                autoFocus
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                placeholder={minBid.toLocaleString('en-US')}
                aria-label="Your bid in dollars"
              />
            </label>
            <button className="gv-bid" type="submit" disabled={!typedValid || placing}>
              {placing ? 'Placing…' : 'Bid'}
            </button>
          </form>
        ) : (
          <div className="gv-bidrow">
            <button
              className="gv-step"
              type="button"
              aria-label={`Lower my bid by ${formatUsd(BID_STEP)}`}
              disabled={placing || amount - BID_STEP < minBid}
              onClick={() => setDialled(amount - BID_STEP)}
            >
              −
            </button>
            <button className="gv-bid" type="button" disabled={placing} onClick={() => void bid(amount)}>
              {placing ? (
                'Placing…'
              ) : (
                <>
                  Bid{' '}
                  <b>
                    <RollingNumber text={formatUsd(amount)} />
                  </b>
                </>
              )}
            </button>
            <button
              className="gv-step"
              type="button"
              aria-label={`Raise my bid by ${formatUsd(BID_STEP)}`}
              disabled={placing || amount + BID_STEP > bidCeiling}
              onClick={() => setDialled(amount + BID_STEP)}
            >
              +
            </button>
          </div>
        )
      ) : (
        <p className="gv-dock-note">The next bid reaches the Buy Now price.</p>
      )}

      {settingMax && (
        <form
          className="gv-max-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (maxValid) void saveMax(maxValue)
          }}
        >
          <p>
            What is the most you would pay? Gavel bids for you, {formatUsd(BID_STEP)} at a time, and only as far as it
            takes to stay ahead.
          </p>
          <div className="gv-type">
            <label className="gv-type-field">
              <span>$</span>
              <input
                inputMode="numeric"
                autoFocus
                value={maxTyped}
                onChange={(event) => setMaxTyped(event.target.value)}
                placeholder={maxFloor.toLocaleString('en-US')}
                aria-label="Your max bid in dollars"
              />
            </label>
            <button className="gv-bid" type="submit" disabled={!maxValid || savingMax}>
              {savingMax ? 'Saving…' : 'Set max'}
            </button>
          </div>
        </form>
      )}

      {maxBid !== null && !settingMax && (
        <p className={maxPassed ? 'gv-max gv-max--passed' : 'gv-max'}>
          {maxPassed ? (
            <>
              The bidding passed your max of <b>{formatUsd(maxBid)}</b>.
            </>
          ) : (
            <>
              Your max is <b>{formatUsd(maxBid)}</b>. Gavel is bidding for you.
            </>
          )}
        </p>
      )}

      <div className="gv-dock-links">
        {canBid && (
          <button className="gv-link" type="button" onClick={() => setTyping((on) => !on)}>
            {typing ? 'Use the quick bid' : 'Enter an amount'}
          </button>
        )}
        {canBid && (
          <button className="gv-link" type="button" onClick={() => setSettingMax((on) => !on)}>
            {settingMax ? 'Cancel' : maxBid === null ? 'Set a max bid' : maxPassed ? 'Raise my max' : 'Change my max'}
          </button>
        )}
        {maxBid !== null && !settingMax && (
          <button className="gv-link" type="button" disabled={savingMax} onClick={() => void saveMax(null)}>
            Remove my max
          </button>
        )}
        {buyNow !== null && (
          <button
            className={confirmingBuy ? 'gv-buy gv-buy--confirm' : 'gv-buy'}
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
            {confirmingBuy ? `Tap again to buy for ${formatUsd(buyNow)}` : `Buy it now for ${formatUsd(buyNow)}`}
          </button>
        )}
      </div>

      {message && (
        <p className="gv-message" role="status">
          {message}
        </p>
      )}
    </div>
  )
}

function EndRound({ auction, upNext }: { auction: AuctionSessionHook; upNext: string | null }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function stop() {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await auction.stopRound()
      if (!result.ok) setMessage(result.error ?? 'Could not end the round. Try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gv-end">
      <button className="gv-link" type="button" disabled={busy} onClick={() => void stop()}>
        {busy ? 'Ending…' : 'End this round now'}
      </button>
      {upNext !== null && (
        <p className="gv-end-next">
          Up next: <b>{upNext}</b>
        </p>
      )}
      {message && (
        <p className="gv-message" role="alert">
          {message}
        </p>
      )}
    </div>
  )
}

// A money field inside the setup sentence: digits only, sized to its text.
function Slot({
  value,
  onChange,
  placeholder,
  label,
  money,
  optional,
}: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  label: string
  money?: boolean
  optional?: boolean
}) {
  const empty = value.trim() === ''
  // Money is kept as bare digits and shown with thousands separators.
  const display = money && !empty ? Number(value).toLocaleString('en-US') : value
  const shown = display || placeholder
  const classes = ['gv-slot']
  if (money) classes.push('gv-slot--money')
  if (optional && empty) classes.push('gv-slot--empty')
  return (
    <label className={classes.join(' ')}>
      {money && !empty && <span aria-hidden="true">$</span>}
      <input
        value={display}
        onChange={(event) => onChange(money ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)}
        placeholder={placeholder}
        inputMode={money ? 'numeric' : 'text'}
        maxLength={money ? 9 : 120}
        size={Math.max(shown.length, money ? 2 : 6)}
        aria-label={label}
      />
    </label>
  )
}

function lengthLabel(seconds: number) {
  return ROUND_LENGTHS.find((option) => option.seconds === seconds)?.label ?? `${seconds} sec`
}

function hostRefusal(status: number) {
  if (status === 401) return 'Zoom has not confirmed who you are. Close Gavel and open it again from Apps.'
  if (status === 403) return 'Only the meeting host can do that.'
  if (status === 429) return 'Too many requests. Try again in a moment.'
  return null
}

// The host's side of the table between rounds: the lots lined up, and the
// form that starts one now or adds it to the line.
function HostDesk({
  state,
  auction,
  sessionKey,
}: {
  state: SessionState
  auction: AuctionSessionHook
  sessionKey: string
}) {
  const { session } = state
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let retry: ReturnType<typeof setTimeout> | undefined
    fetchQueue(sessionKey)
      .then((next) => {
        if (active && next) setQueue(next)
      })
      .catch(() => {
        // Without the list the host has no way to start the next lot.
        if (active && attempt < QUEUE_READ_RETRIES) retry = setTimeout(() => setAttempt((n) => n + 1), 1500)
      })
    return () => {
      active = false
      clearTimeout(retry)
    }
  }, [sessionKey, session.queuedCount, session.upNext, attempt])

  // One queue request at a time, so the list always shows the latest answer.
  async function run(request: () => ReturnType<typeof queueAdd>, fallback: string) {
    if (busy) return 'Still working on the last change. Try again in a moment.'
    setBusy(true)
    setMessage('')
    try {
      const result = await request()
      if (result.state) auction.absorb(result.state)
      if (result.ok) {
        setQueue(result.queue)
        return null
      }
      return (
        hostRefusal(result.status) ??
        (result.reason === 'queue_full'
          ? 'The queue is full. Start or remove a lot first.'
          : result.reason === 'round_open'
            ? 'A round is already running.'
            : result.reason === 'queue_empty'
              ? 'There is nothing left in the queue.'
              : fallback)
      )
    } catch {
      return fallback
    } finally {
      setBusy(false)
    }
  }

  async function startNext() {
    if (busy) return
    const error = await run(() => queueStartNext(sessionKey), 'Could not start the next lot. Try again.')
    if (error) setMessage(error)
  }

  async function remove(id: number) {
    if (busy) return
    const error = await run(() => queueRemove(sessionKey, id), 'Could not remove that lot. Try again.')
    if (error) setMessage(error)
  }

  return (
    <>
      {queue.length > 0 && (
        <div className="gv-queue">
          <div className="gv-sect">
            <h3>Up next</h3>
            <span>
              {queue.length} {queue.length === 1 ? 'lot' : 'lots'} lined up
            </span>
          </div>
          <ol className="gv-queue-list">
            {queue.map((lot, index) => (
              <li key={lot.id}>
                <span className="gv-queue-no" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="gv-name">
                  <strong>{lot.itemName}</strong>
                  <span>
                    {[
                      `Starts at ${formatUsd(lot.openingBid)}`,
                      lot.reservePrice !== null ? `Reserve ${formatUsd(lot.reservePrice)}` : null,
                      lot.buyNowPrice !== null ? `Buy Now ${formatUsd(lot.buyNowPrice)}` : null,
                      lengthLabel(lot.seconds),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <button
                  className="gv-queue-remove"
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${lot.itemName} from the queue`}
                  onClick={() => void remove(lot.id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ol>
          <button className="gv-start" type="button" disabled={busy} onClick={() => void startNext()}>
            {busy ? 'Working…' : `Start ${queue[0].itemName}`}
          </button>
          {message && (
            <p className="gv-message" role="alert">
              {message}
            </p>
          )}
        </div>
      )}
      <HostSetup
        state={state}
        auction={auction}
        queued={queue.length}
        queueBusy={busy}
        onQueue={(lot) => run(() => queueAdd(sessionKey, lot), 'Could not add the lot. Try again.')}
      />
    </>
  )
}

// The host sets a lot up the way they would say it out loud.
function HostSetup({
  state,
  auction,
  queued,
  queueBusy,
  onQueue,
}: {
  state: SessionState
  auction: AuctionSessionHook
  queued: number
  queueBusy: boolean
  /** Adds the lot to the queue; resolves to an error message, or null. */
  onQueue: (lot: QueueLot) => Promise<string | null>
}) {
  const { session } = state
  const first = session.roundNo === 0
  const [itemName, setItemName] = useState('')
  const [opening, setOpening] = useState('')
  const [reserve, setReserve] = useState('')
  const [buyNow, setBuyNow] = useState('')
  const [seconds, setSeconds] = useState(60)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const openingValue = Number.parseInt(opening, 10)
  const reserveValue = reserve === '' ? null : Number.parseInt(reserve, 10)
  const buyNowValue = buyNow === '' ? null : Number.parseInt(buyNow, 10)
  const openingOk = Number.isInteger(openingValue) && openingValue >= 0 && openingValue <= MAX_BID
  const reserveOk = reserveValue === null || (Number.isInteger(reserveValue) && reserveValue <= MAX_BID)
  const buyNowOk =
    buyNowValue === null ||
    (Number.isInteger(buyNowValue) &&
      openingOk &&
      buyNowValue > openingValue &&
      buyNowValue <= MAX_BID &&
      (reserveValue === null || buyNowValue >= reserveValue))
  const ready = itemName.trim().length > 0 && openingOk && reserveOk && buyNowOk

  let hint = ''
  if (!buyNowOk) hint = 'Buy Now has to be above the starting bid, and not below the reserve.'

  async function start() {
    if (!ready || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await auction.startRound({
        itemName: itemName.trim(),
        openingBid: openingValue,
        reservePrice: reserveValue,
        buyNowPrice: buyNowValue,
        seconds,
      })
      if (!result.ok) {
        setMessage(
          result.reason === 'round_open'
            ? 'A round is already running.'
            : result.status === 401
              ? 'Zoom has not confirmed who you are. Close Gavel and open it again from Apps.'
              : result.status === 403
                ? 'Only the meeting host can start a lot.'
                : (result.error ?? 'Could not start the lot. Try again.'),
        )
      }
    } finally {
      setBusy(false)
    }
  }

  async function addToQueue() {
    if (!ready || busy || queueBusy) return
    setBusy(true)
    setMessage('')
    const error = await onQueue({
      itemName: itemName.trim(),
      openingBid: openingValue,
      reservePrice: reserveValue,
      buyNowPrice: buyNowValue,
      seconds,
    })
    if (error) {
      setMessage(error)
    } else {
      // Ready for the next one; the round length usually stays the same.
      setItemName('')
      setOpening('')
      setReserve('')
      setBuyNow('')
    }
    setBusy(false)
  }

  return (
    <form
      className="gv-setup"
      onSubmit={(event) => {
        event.preventDefault()
        // Return does what the heading says: with lots lined up, it adds.
        void (queued > 0 ? addToQueue() : start())
      }}
    >
      <p className="gv-setup-kicker">
        {queued > 0 ? 'Add another lot' : first ? 'Your first lot' : `Lot ${session.roundNo + 1}`}
      </p>
      {/* Each field travels with its punctuation, so a comma never starts a line. */}
      <p className="gv-sentence">
        Sell <Slot value={itemName} onChange={setItemName} placeholder="an item" label="Item name" /> starting at{' '}
        <span className="gv-keep">
          <Slot value={opening} onChange={setOpening} placeholder="$0" label="Starting bid in dollars" money />,
        </span>{' '}
        reserve{' '}
        <span className="gv-keep">
          <Slot value={reserve} onChange={setReserve} placeholder="None" label="Reserve price in dollars, optional" money optional />,
        </span>{' '}
        Buy Now{' '}
        <span className="gv-keep">
          <Slot value={buyNow} onChange={setBuyNow} placeholder="None" label="Buy Now price in dollars, optional" money optional />.
        </span>
      </p>
      <div className="gv-lengths" role="radiogroup" aria-label="Round length">
        {ROUND_LENGTHS.map((option) => (
          <button
            key={option.seconds}
            type="button"
            role="radio"
            aria-checked={seconds === option.seconds}
            className={seconds === option.seconds ? 'gv-length gv-length--on' : 'gv-length'}
            onClick={() => setSeconds(option.seconds)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {hint && <p className="gv-message">{hint}</p>}
      <div className="gv-setup-actions">
        <button
          className="gv-start gv-start--quiet"
          type={queued > 0 ? 'submit' : 'button'}
          disabled={!ready || busy || queueBusy}
          onClick={queued > 0 ? undefined : () => void addToQueue()}
        >
          Add to queue
        </button>
        <button
          className="gv-start"
          type={queued > 0 ? 'button' : 'submit'}
          disabled={!ready || busy}
          onClick={queued > 0 ? () => void start() : undefined}
        >
          {busy ? 'Working…' : queued > 0 ? 'Start this now' : 'Start bidding'}
        </button>
      </div>
      {message && (
        <p className="gv-message" role="alert">
          {message}
        </p>
      )}
    </form>
  )
}

function Invite({ sessionKey, onInviteMeeting }: { sessionKey: string; onInviteMeeting?: () => Promise<void> }) {
  const [copied, setCopied] = useState(false)
  const [showLink, setShowLink] = useState(false)
  const [inviting, setInviting] = useState('')
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
      // The Zoom client blocks the clipboard: show the link to select by hand.
      setShowLink(true)
    }
  }

  async function inviteMeeting() {
    if (!onInviteMeeting) return
    setInviting('Opening Gavel for everyone…')
    try {
      await onInviteMeeting()
      setInviting('Everyone in the meeting has been invited.')
    } catch {
      setInviting('Could not invite the meeting. Share the link instead.')
    }
  }

  return (
    <div className="gv-invite">
      <div className="gv-invite-row">
        <p>
          Bring people in
          <span>Anyone with the link can bid from a browser.</span>
        </p>
        <button className="gv-pill" type="button" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      {showLink && (
        <input
          className="gv-invite-link"
          type="text"
          readOnly
          value={shareUrl}
          aria-label="Join link. Select it and copy."
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
        />
      )}
      {onInviteMeeting && (
        <div className="gv-invite-row">
          <p>
            Open it for the meeting
            <span>Everyone here gets a prompt to join.</span>
          </p>
          <button className="gv-pill" type="button" onClick={() => void inviteMeeting()}>
            Invite all
          </button>
        </div>
      )}
      {inviting && (
        <p className="gv-message" role="status">
          {inviting}
        </p>
      )}
    </div>
  )
}

// Finished lots as a receipt, with a CSV for collecting payment outside the
// app. The server refuses this to non-hosts on meeting sessions, in which
// case nothing renders.
function Receipt({ state, sessionKey }: { state: SessionState; sessionKey: string }) {
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
    <div className="gv-receipt-wrap">
      <div className="gv-receipt">
        <h3>So far</h3>
        <ol>
          {rounds.map((round) => (
            <li key={round.roundNo}>
              <span>
                {round.itemName}
                <em>
                  {round.outcome === 'sold' && round.winner
                    ? `${displayName(round.winner.name)}${round.boughtNow ? ', Buy Now' : ''}`
                    : outcomeLabel(round)}
                </em>
              </span>
              <span>{round.outcome === 'sold' ? formatUsd(round.finalBid) : ''}</span>
            </li>
          ))}
        </ol>
        <p className="gv-receipt-total">
          <span>Raised</span>
          <span>{formatUsd(total)}</span>
        </p>
      </div>
      <div className="gv-receipt-foot">
        <a href={resultsUrl(sessionKey, 'csv')} download="gavel-results.csv">
          Download CSV
        </a>
        <span>
          {sold.length} of {rounds.length} sold
        </span>
      </div>
    </div>
  )
}
