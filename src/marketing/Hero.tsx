'use client'

import Image from 'next/image'
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  BID_STEP as BID_INCREMENT,
  DEMO_OPENING_BID as OPENING_BID,
  formatUsd,
} from '@/lib/gavel/demo'
import heroAtmosphere from './assets/hero-atmosphere.png'
import heroLot from './assets/hero-lot.png'
import logoMark from './assets/logo.png'

type BidEvent = { at: number; paddle: string; amount: number }

const OPENING_CLOCK = 12
const EXTEND_TO = 12
const EXTEND_THRESHOLD = 3
const SOLD_HOLD = 5
const RESERVE = 1100
const RING_LENGTH = 2 * Math.PI * 16

const SCRIPT: BidEvent[] = [
  { at: 2, paddle: 'Paddle 07', amount: 990 },
  { at: 4, paddle: 'Paddle 12', amount: 1015 },
  { at: 7, paddle: 'Paddle 03', amount: 1060 },
  { at: 9, paddle: 'Paddle 07', amount: 1090 },
  { at: 11, paddle: 'Paddle 12', amount: 1150 },
  { at: 14, paddle: 'Paddle 03', amount: 1190 },
  { at: 16, paddle: 'Paddle 07', amount: 1240 },
]

const STRIP_TILES = [
  { name: 'Paddle 07', initials: '07' },
  { name: 'Paddle 12', initials: '12' },
  { name: 'Paddle 03', initials: '03' },
] as const

type AuctionState = {
  price: number
  clock: number
  feed: BidEvent[]
  extended: boolean
  sold: boolean
  bidCount: number
}

// Every animation frame, precomputed in one pass at module load. The
// interval just indexes into this array: O(1) per tick, no replays.
const TIMELINE: AuctionState[] = (() => {
  const bidsByTick = new Map(SCRIPT.map((b) => [b.at, b]))
  const frames: AuctionState[] = []
  let price = OPENING_BID
  let clock = OPENING_CLOCK
  let sold = false
  let bidCount = 0
  const feed: BidEvent[] = []

  frames.push({ price, clock, feed: [], extended: false, sold: false, bidCount: 0 })

  for (let t = 1; !sold; t++) {
    clock -= 1
    let extended = false
    const bid = bidsByTick.get(t)
    if (bid) {
      price = bid.amount
      bidCount += 1
      feed.unshift(bid)
      if (clock <= EXTEND_THRESHOLD) {
        clock = EXTEND_TO
        extended = true
      }
    }
    if (clock <= 0) sold = true
    frames.push({
      price,
      clock: Math.max(clock, 0),
      feed: feed.slice(0, 5),
      extended,
      sold,
      bidCount,
    })
  }

  for (let i = 0; i < SOLD_HOLD; i++) frames.push(frames[frames.length - 1])
  return frames
})()

const LOOP_LENGTH = TIMELINE.length
const STATIC_FRAME = 7

function frameAt(tick: number): AuctionState {
  return TIMELINE[Math.min(tick, TIMELINE.length - 1)]
}

function subscribeToMotionPreference(callback: () => void) {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)')
  query.addEventListener('change', callback)
  return () => query.removeEventListener('change', callback)
}

function readMotionPreference() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function Hero() {
  const [tick, setTick] = useState(0)
  const reducedMotion = useSyncExternalStore(
    subscribeToMotionPreference,
    readMotionPreference,
    () => false,
  )

  useEffect(() => {
    if (reducedMotion) return

    let id: ReturnType<typeof setInterval> | null = null

    // Only animate while the tab is actually visible: a backgrounded
    // landing page should cost nothing.
    const start = () => {
      if (id === null) {
        id = setInterval(() => setTick((t) => (t + 1) % LOOP_LENGTH), 1000)
      }
    }
    const stop = () => {
      if (id !== null) {
        clearInterval(id)
        id = null
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reducedMotion])

  const state = frameAt(reducedMotion ? STATIC_FRAME : tick)

  const clockLow = !state.sold && state.clock <= 4
  const lastBid = state.feed[0] ?? null
  // All transient "just happened" affordances are motion: freeze them
  // entirely under reduced motion rather than comparing a live tick
  // against a static frame.
  const biddingPaddle =
    !reducedMotion && !state.sold && lastBid && tick - lastBid.at < 2
      ? lastBid.paddle
      : null
  const toastBid =
    !reducedMotion && !state.sold && lastBid && tick - lastBid.at < 3
      ? lastBid
      : null
  const clockRatio = state.sold ? 0 : state.clock / EXTEND_TO
  const leader = lastBid?.paddle ?? null
  const nextBid = state.price + BID_INCREMENT
  const reserveMet = state.price >= RESERVE

  return (
    <section className="hero" aria-label="Zoom Gavel, live bidding inside Zoom meetings">
      <div className="hero-atmosphere" aria-hidden="true">
        <Image
          src={heroAtmosphere}
          alt=""
          fill
          sizes="100vw"
          className="hero-atmosphere-image"
        />
      </div>

      <header className="navbar">
        <span className="navbar-brand">
          <Image
            src={logoMark}
            alt=""
            width={34}
            height={34}
            className="navbar-logo"
          />
          Zoom Gavel
        </span>
        <nav className="navbar-links" aria-label="Page">
          <a className="navbar-link" href="#demo">
            Live demo
          </a>
          <a
            className="navbar-link"
            href="https://github.com/SankrityaT/zoom-gavel"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
        <a className="navbar-cta" href="/zoom-test">
          Open in Zoom
        </a>
      </header>

      <div className="hero-intro">
        <h1 className="hero-headline">
          The auction never
          <br />
          leaves the meeting.
        </h1>
        <p className="hero-sub">
          Live bidding inside the Zoom window itself. No second tab, no screen
          share pretending to be a sale.
        </p>
      </div>

      <div id="demo" className="zoom-window" aria-label="Simulated Zoom meeting running the Gavel panel">
        <div className="zoom-titlebar">
          <span className="zoom-lights" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span className="zoom-title">Zoom Meeting</span>
          <span className="zoom-rec" aria-hidden="true">
            <i /> LIVE
          </span>
        </div>

        <div className="zoom-body">
          <div className="zoom-stage">
            <Image
              src={heroLot}
              alt="Lot 001, a cobalt glass horse with a coral fracture, shown on the host camera"
              fill
              priority
              sizes="(max-width: 900px) 100vw, 60vw"
              className="zoom-stage-image"
            />

            <div className="zoom-filmstrip" aria-hidden="true">
              {STRIP_TILES.map((tile) => (
                <figure
                  key={tile.name}
                  className={
                    tile.name === biddingPaddle
                      ? 'zoom-tile zoom-tile--bidding'
                      : 'zoom-tile'
                  }
                >
                  <span className="zoom-avatar">{tile.initials}</span>
                  {tile.name === biddingPaddle && (
                    <span className="zoom-bid-chip">BID</span>
                  )}
                  <figcaption className="zoom-tile-name">{tile.name}</figcaption>
                </figure>
              ))}
            </div>

            <span className="zoom-stage-name">Maya · Host</span>
            <span className="zoom-stage-lot" aria-hidden="true">
              Lot 001
            </span>

            {toastBid && (
              <p key={toastBid.at} className="zoom-toast" aria-hidden="true">
                {toastBid.paddle} bids {formatUsd(toastBid.amount)}
              </p>
            )}

            {state.sold && (
              <div className="zoom-sold-overlay" aria-hidden="true">
                <span className="zoom-sold-stamp">
                  Sold · {formatUsd(state.price)}
                </span>
              </div>
            )}
          </div>

          <aside
            className={state.sold ? 'gavel-panel gavel-panel--sold' : 'gavel-panel'}
            aria-label="Gavel auction panel, simulated demo"
          >
            <div className="gavel-head">
              <span className="gavel-brand">
                <Image
                  src={logoMark}
                  alt=""
                  width={20}
                  height={20}
                  className="gavel-brand-logo"
                />
                Zoom Gavel
              </span>
              <span className="gavel-paddles" aria-hidden="true">
                {STRIP_TILES.length} paddles in
              </span>
            </div>

            <div className="gavel-lot-row">
              <span className="gavel-lot">Lot 001 · Glass horse</span>
              {reserveMet ? (
                <span key="met" className="gavel-reserve gavel-reserve--met">
                  Reserve met
                </span>
              ) : (
                <span className="gavel-reserve">Reserve {formatUsd(RESERVE)}</span>
              )}
            </div>

            <div className="gavel-price-block">
              <span key={state.price} className="gavel-price">
                {formatUsd(state.price)}
              </span>
              <span className={state.sold ? 'gavel-winner gavel-winner--sold' : 'gavel-winner'}>
                {state.sold
                  ? `${leader ?? 'Paddle 07'} wins the lot`
                  : leader
                    ? `${leader} is winning`
                    : 'Opening bid, no paddles yet'}
              </span>
            </div>

            <ol className="gavel-ladder">
              {state.feed.map((bid, index) => (
                <li
                  key={bid.at}
                  className={index === 0 ? 'gavel-rung gavel-rung--leader' : 'gavel-rung'}
                >
                  <span className="gavel-rung-dot" aria-hidden="true" />
                  <span className="gavel-rung-paddle">{bid.paddle}</span>
                  <span className="gavel-rung-amount">{formatUsd(bid.amount)}</span>
                </li>
              ))}
              <li className="gavel-rung gavel-rung--empty">
                <span className="gavel-rung-dot" aria-hidden="true" />
                <span className="gavel-rung-paddle">Opening bid</span>
                <span className="gavel-rung-amount">{formatUsd(OPENING_BID)}</span>
              </li>
            </ol>

            {state.sold ? (
              <div className="gavel-sold-block" aria-hidden="true">
                <span className="gavel-sold-word">Sold</span>
                <span className="gavel-sold-price">{formatUsd(state.price)}</span>
              </div>
            ) : (
              <div className="gavel-action" aria-hidden="true">
                <span className={clockLow ? 'gavel-ring gavel-ring--low' : 'gavel-ring'}>
                  <svg viewBox="0 0 40 40" width="46" height="46">
                    <circle className="gavel-ring-track" cx="20" cy="20" r="16" />
                    <circle
                      className="gavel-ring-fill"
                      cx="20"
                      cy="20"
                      r="16"
                      strokeDasharray={RING_LENGTH}
                      strokeDashoffset={RING_LENGTH * (1 - clockRatio)}
                      transform="rotate(-90 20 20)"
                    />
                  </svg>
                  <em>{state.clock}</em>
                </span>
                <span className="gavel-bid-button">Bid {formatUsd(nextBid)}</span>
                <span className="gavel-custom-button">Custom</span>
              </div>
            )}

            {state.extended && !state.sold && (
              <p className="gavel-extend" aria-hidden="true">
                Late bid, clock extended +{EXTEND_TO}s
              </p>
            )}
          </aside>
        </div>

        <div className="zoom-toolbar" aria-hidden="true">
          <span className="zoom-tool">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            </svg>
            Mute
          </span>
          <span className="zoom-tool">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="6" width="13" height="12" rx="2" />
              <path d="M16 10.5 21 8v8l-5-2.5" />
            </svg>
            Video
          </span>
          <span className="zoom-tool">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <circle cx="9" cy="8" r="3.2" />
              <circle cx="16.5" cy="9.5" r="2.4" />
              <path d="M3.5 19a5.5 5.5 0 0 1 11 0M13.5 19a4.5 4.5 0 0 1 7 -3.6" />
            </svg>
            Participants
          </span>
          <span className="zoom-tool">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 15V4M8 8l4-4 4 4" />
              <rect x="4" y="13" width="16" height="7" rx="2" />
            </svg>
            Share
          </span>
          <span className="zoom-tool zoom-tool--active">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="4" y="4" width="7" height="7" rx="1.5" />
              <rect x="13" y="4" width="7" height="7" rx="1.5" />
              <rect x="4" y="13" width="7" height="7" rx="1.5" />
              <rect x="13" y="13" width="7" height="7" rx="1.5" />
            </svg>
            Apps
          </span>
          <span className="zoom-leave">Leave</span>
        </div>
      </div>
    </section>
  )
}
