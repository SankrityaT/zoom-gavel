'use client'

import Image from 'next/image'
import { useRef, useState } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import { AppSidebar, DANA, GLASS_HORSE, MARCUS, PEOPLE, PRIYA, RoundPanel, useOnScreen } from './demo'
import heroLot from './assets/hero-lot.png'
import { PaperTag, Slab } from './paper'
import { type SimRival, useSimAuction } from './sim'

// How far each pretend bidder will go. Bid past the last of them and the
// horse is yours.
const RIVALS: SimRival[] = [
  { key: PRIYA.key, ceiling: 1150 },
  { key: DANA.key, ceiling: 1200 },
  { key: MARCUS.key, ceiling: 1275 },
]

const NOTES = [
  {
    title: 'Amounts stay private',
    body: 'Everyone sees the ranking and the current price. Any other amount shows as a lock, except to the person who bid it and the host.',
  },
  {
    title: 'A max bid does the tapping',
    body: 'Set the most you would pay. Gavel bids for you $25 at a time, and only as far as it takes to stay ahead.',
  },
  {
    title: 'Buy Now ends it',
    body: 'When the host sets a Buy Now price, two taps take the lot at that price. If two people try at once, one of them gets it and the other finds the round closed.',
  },
  {
    title: 'You hear it too',
    body: 'In a meeting the panel plays a sound when bidding opens, when you are passed, through the last five seconds, and when the hammer falls. This page keeps them off.',
  },
]

// Paper squares thrown when the hammer falls: angle, distance, colour.
const CONFETTI = Array.from({ length: 22 }, (_, index) => ({
  angle: (index * 137.5) % 360,
  reach: 120 + ((index * 53) % 150),
  tone: ['blue', 'coral', 'mint', 'pink', 'grey'][index % 5],
  turn: ((index * 71) % 300) - 150,
}))

export default function Paddle() {
  const root = useRef<HTMLElement>(null)
  const onScreen = useOnScreen(root)
  const [asHost, setAsHost] = useState(false)
  const { state, auction, restart } = useSimAuction({
    lot: GLASS_HORSE,
    people: PEOPLE,
    rivals: RIVALS,
    viewer: asHost ? 'host' : 'bidder',
    asBidder: true,
    persistent: true,
    active: onScreen,
    stillAt: 0,
  })
  const { session } = state
  const closed = session.status === 'closed'
  const sold = closed && session.leader !== null && session.reserveMet
  const won = sold && session.leader?.bidderKey === auction.selfKey

  return (
    <section id="paddle" className="paddle" ref={root} aria-labelledby="paddle-title">
      <Slab tone="blue" className="paddle-slab-a" drift={-14} />
      <Slab tone="pink" className="paddle-slab-b" drift={18} />
      <div className="wrap">
        <div className="paddle-intro">
          <h2 id="paddle-title" className="title" data-lines>
            <span className="mask">
              <span className="line">Go on, bid on the horse</span>
            </span>
          </h2>
          <p className="lede" data-rise>
            The panel a bidder gets in the meeting, running against three pretend bidders in your browser. Nothing you
            do here is sent anywhere.
          </p>
        </div>

        <div className="paddle-table" data-rise>
          <figure className="paddle-lot">
            <div className="paddle-photo">
              <Image
                src={heroLot}
                alt="Lot 1, a cobalt glass horse with a coral fracture, on a stone plinth"
                fill
                sizes="(max-width: 960px) 100vw, 640px"
                className="paddle-photo-image"
              />
              {sold && (
                <span key={session.currentBid} className="paddle-stamp">
                  Sold
                </span>
              )}
            </div>
            <PaperTag className="paddle-lot-tag">
              <span className="ptag-small">Lot 1 · Glass horse</span>
              <span className="ptag-price">{formatUsd(session.currentBid)}</span>
              <span className="ptag-small">
                {sold ? (won ? 'Yours' : `Sold to ${session.leader?.name}`) : closed ? 'Not sold' : 'Current bid'}
              </span>
            </PaperTag>
            {sold && (
              <span className="paddle-confetti" aria-hidden="true">
                {CONFETTI.map((piece, index) => (
                  <i
                    key={index}
                    className={`bit bit--${piece.tone}`}
                    style={{
                      ['--x' as string]: `${Math.cos((piece.angle * Math.PI) / 180) * piece.reach}px`,
                      ['--y' as string]: `${Math.sin((piece.angle * Math.PI) / 180) * piece.reach}px`,
                      ['--turn' as string]: `${piece.turn}deg`,
                      animationDelay: `${(index % 6) * 30}ms`,
                    }}
                  />
                ))}
              </span>
            )}
          </figure>

          <div className="paddle-panel">
            <AppSidebar>
              <RoundPanel state={state} auction={auction} alerts />
            </AppSidebar>
            <div className="paddle-controls">
              <p className="paddle-result" role="status">
                {closed
                  ? won
                    ? `Yours for ${formatUsd(session.currentBid)}.`
                    : sold
                      ? `${session.leader?.name} took it for ${formatUsd(session.currentBid)}.`
                      : 'It did not sell this time.'
                  : asHost
                    ? 'This is what the host sees: every amount.'
                    : 'This is what a bidder sees.'}
              </p>
              <div className="paddle-buttons">
                <button className="chip" type="button" aria-pressed={asHost} onClick={() => setAsHost((on) => !on)}>
                  {asHost ? 'See it as a bidder' : 'See it as the host'}
                </button>
                <button className={closed ? 'chip chip--ink' : 'chip'} type="button" onClick={restart}>
                  {closed ? 'Run the lot again' : 'Start over'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <ul className="paddle-notes" data-rise="group">
          {NOTES.map((note) => (
            <li key={note.title}>
              <h3>{note.title}</h3>
              <p>{note.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
