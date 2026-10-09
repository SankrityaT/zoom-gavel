'use client'

import { useRef, useState } from 'react'
import { formatUsd } from '@/lib/gavel/demo'
import { AppSidebar, DANA, GLASS_HORSE, MARCUS, PEOPLE, PRIYA, RoundPanel, useOnScreen } from './demo'
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
  const won = closed && session.leader?.bidderKey === auction.selfKey && session.reserveMet

  return (
    <section id="paddle" className="paddle" ref={root} aria-labelledby="paddle-title">
      <div className="wrap">
        <div className="paddle-intro">
          <h2 id="paddle-title" className="title" data-lines>
            <span className="mask">
              <span className="line">Bid on the glass horse</span>
            </span>
          </h2>
          <p className="lede" data-rise>
            This is the panel a bidder gets in the meeting, running against three pretend bidders in your browser.
            Nothing you do here is sent anywhere. Bidding starts at {formatUsd(GLASS_HORSE.openingBid)}.
          </p>
        </div>

        <div className="paddle-table">
          <ul className="paddle-notes" data-rise="group">
            {NOTES.slice(0, 2).map((note) => (
              <li key={note.title}>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </li>
            ))}
          </ul>

          <div className="paddle-panel">
            <AppSidebar>
              <RoundPanel state={state} auction={auction} alerts />
            </AppSidebar>
            <div className="paddle-controls">
              <p className="paddle-result" role="status">
                {closed
                  ? won
                    ? `Yours for ${formatUsd(session.currentBid)}.`
                    : session.leader && session.reserveMet
                      ? `${session.leader.name} took it for ${formatUsd(session.currentBid)}.`
                      : 'It did not sell this time.'
                  : asHost
                    ? 'You are looking at what the host sees: every amount.'
                    : 'You are looking at what a bidder sees.'}
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

          <ul className="paddle-notes" data-rise="group">
            {NOTES.slice(2).map((note) => (
              <li key={note.title}>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
